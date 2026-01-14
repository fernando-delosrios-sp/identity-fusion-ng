import { Response, StdAccountListInput, StdAccountListOutput } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'
import { assert } from '../utils/assert'

export const accountList = async (
    serviceRegistry: ServiceRegistry,
    input: StdAccountListInput,
    res: Response<StdAccountListOutput>
) => {
    ServiceRegistry.setCurrent(serviceRegistry)
    const { log, fusion, forms, identities, schemas, sources, attributes, messaging } = serviceRegistry

    try {
        log.info('Starting account list operation')

        await sources.fetchAllSources()
        if (fusion.isReset()) {
            log.info('Reset flag detected, disabling reset and exiting')
            await fusion.disableReset()
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
            forms.fetchFormData(),
            identities.fetchIdentities(),
            sources.fetchManagedAccounts(),
            messaging.fetchSender(),
        ]

        await Promise.all(fetchPromises)
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
            const report = fusion.generateReport()
            assert(report, 'Failed to generate fusion report')
            await messaging.sendReport(report)
        }

        const accounts = await fusion.listISCAccounts()
        assert(accounts, 'Failed to list ISC accounts')
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
