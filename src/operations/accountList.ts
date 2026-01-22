import { Response, StdAccountListInput, StdAccountListOutput } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'
import { assert, softAssert } from '../utils/assert'
import { generateReport } from './helpers/generateReport'

export const accountList = async (
    serviceRegistry: ServiceRegistry,
    input: StdAccountListInput,
    res: Response<StdAccountListOutput>
) => {
    ServiceRegistry.setCurrent(serviceRegistry)
    const { log, fusion, forms, identities, schemas, sources, attributes, messaging } = serviceRegistry

    try {
        log.info('Starting account list operation')

        // Validate required inputs
        assert(input, 'Account list input is required')
        assert(serviceRegistry, 'Service registry is required')

        // Validate service registry components
        assert(log, 'Log service is required')
        assert(fusion, 'Fusion service is required')
        assert(forms, 'Form service is required')
        assert(identities, 'Identity service is required')
        assert(schemas, 'Schema service is required')
        assert(sources, 'Source service is required')
        assert(attributes, 'Attribute service is required')
        assert(messaging, 'Messaging service is required')

        await sources.fetchAllSources()
        if (fusion.isReset()) {
            log.info('Reset flag detected, disabling reset and exiting')
            await forms.deleteExistingForms()
            await fusion.disableReset()
            await fusion.resetState()
            return
        }

        await schemas.setFusionAccountSchema(input.schema)
        log.debug('Fusion account schema set successfully')

        await sources.aggregateManagedSources()
        log.debug('Managed sources aggregated')

        await attributes.initializeCounters()
        log.debug('Attribute counters initialized')

        log.debug('Fetching fusion accounts, form data, identities, managed accounts, and sender')
        const fetchPromises = [
            sources.fetchFusionAccounts(),
            identities.fetchIdentities(),
            sources.fetchManagedAccounts(),
            messaging.fetchSender(),
        ]

        await Promise.all(fetchPromises)
        const fusionOwner = sources.fusionSourceOwner
        assert(fusionOwner, 'Fusion source owner is required')
        assert(fusionOwner.id, 'Fusion source owner ID is required')

        if (fusion.fusionReportOnAggregation) {
            const fusionOwnerIdentity = identities.getIdentityById(fusionOwner.id)
            if (!fusionOwnerIdentity) {
                log.info(`Fusion owner identity missing. Fetching identity: ${fusionOwner.id}`)
                try {
                    await identities.fetchIdentityById(fusionOwner.id!)
                } catch (error) {
                    log.error(`Failed to fetch fusion owner identity: ${fusionOwner.id}`, error)
                    log.warn('Fusion report will be skipped due to missing owner identity')
                }
            }
        }

        await forms.fetchFormData()
        log.debug('All fetch operations completed')

        log.debug('Processing fusion accounts and identities')
        await fusion.processFusionAccounts()
        await fusion.processIdentities()

        identities.clear()
        log.debug('Identities cache cleared')

        log.debug('Processing identity fusion decisions and managed accounts')
        await fusion.processIdentityFusionDecisions()
        await fusion.processManagedAccounts()

        if (fusion.fusionReportOnAggregation) {
            log.info('Generating and sending fusion report')
            const fusionOwnerAccount = fusion.getFusionIdentity(fusionOwner.id!)
            softAssert(fusionOwnerAccount, 'Fusion owner account not found')
            if (fusionOwnerAccount) {
                await generateReport(fusionOwnerAccount, serviceRegistry)
            }
        }

        const accounts = await fusion.listISCAccounts()
        assert(accounts, 'Failed to list ISC accounts')
        assert(Array.isArray(accounts), 'ISC accounts must be an array')
        log.info(`Sending ${accounts.length} account(s)`)

        accounts.forEach((x) => res.send(x))

        await forms.cleanUpForms()
        log.debug('Form cleanup completed')

        await attributes.saveState()
        log.debug('Attribute state saved')

        log.info(`Account listing completed successfully - processed ${accounts.length} account(s)`)
    } catch (error) {
        log.crash('Failed to list accounts', error)
    }
}
