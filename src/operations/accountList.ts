import { Response, StdAccountListInput, StdAccountListOutput } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'

export const accountList = async (
    serviceRegistry: ServiceRegistry,
    input: StdAccountListInput,
    res: Response<StdAccountListOutput>
) => {
    ServiceRegistry.setCurrent(serviceRegistry)
    const { log, fusion, forms, identities, schemas, sources, attributes, messaging } = serviceRegistry

    try {
        await sources.fetchAllSources()
        if (fusion.isReset()) {
            await fusion.disableReset()
            return
        }

        await schemas.setFusionAccountSchema(input.schema)
        await sources.aggregateManagedSources()
        // attributes.setStateWrapper(input.state)
        await attributes.initializeCounters()

        const fetchPromises = [
            sources.fetchFusionAccounts(),
            forms.fetchFormData(),
            identities.fetchIdentities(),
            sources.fetchManagedAccounts(),
            messaging.prepareSender(),
        ]

        await Promise.all(fetchPromises)

        await fusion.processFusionAccounts()
        await fusion.processIdentities()

        identities.clear()

        await fusion.processIdentityFusionDecisions()
        await fusion.processManagedAccounts()
        if (serviceRegistry.config.fusionReportOnAggregation) {
            const report = fusion.generateReport()
            await messaging.sendReport(report)
        }
        const accounts = await fusion.listISCAccounts()
        accounts.forEach((x) => res.send(x))

        await forms.cleanUpForms()
        await attributes.saveState()

        log.info('Account listing completed')
    } catch (error) {
        log.crash('Failed to list accounts', error)
    }
}
