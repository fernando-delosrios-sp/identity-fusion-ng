import { Response, StdAccountListInput, StdAccountListOutput } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'

export const accountList = async (
    serviceRegistry: ServiceRegistry,
    input: StdAccountListInput,
    res: Response<StdAccountListOutput>
) => {
    ServiceRegistry.setCurrent(serviceRegistry)
    const { log, fusion, accounts, forms, identities, schemas, sources, attributes } = serviceRegistry

    try {
        attributes.setStateWrapper(input.state)
        await sources.fetchAllSources()
        await schemas.setFusionAccountSchema(input.schema)
        await sources.aggregateManagedSources()
        fusion.checkAttributeDefinitions()

        const fetchPromises = [
            accounts.fetchFusionAccounts(),
            forms.fetchFormData(),
            identities.fetchIdentities(),
            accounts.fetchManagedAccounts(),
        ]

        await Promise.all(fetchPromises)

        await fusion.processFusionAccounts()
        await fusion.processIdentities()

        identities.clear()

        await fusion.processIdentityFusionDecisions()
        await fusion.processManagedAccounts()

        for (const account of fusion.listISCAccounts()) {
            res.send(account)
        }
        await forms.cleanUpForms()

        log.info('Account listing completed')
    } catch (error) {
        log.crash('Failed to list accounts', error)
    }
}
