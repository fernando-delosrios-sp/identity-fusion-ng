import { Response, StdAccountEnableInput, StdAccountEnableOutput } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'
import { assert } from '../utils/assert'

export const accountEnable = async (
    serviceRegistry: ServiceRegistry,
    input: StdAccountEnableInput,
    res: Response<StdAccountEnableOutput>
) => {
    ServiceRegistry.setCurrent(serviceRegistry)
    const { log, fusion, sources, schemas, attributes } = serviceRegistry

    try {
        assert(input, 'Account enable input is required')
        assert(input.identity, 'Account identity is required')
        assert(serviceRegistry, 'Service registry is required')
        assert(log, 'Log service is required')
        assert(fusion, 'Fusion service is required')
        assert(sources, 'Source service is required')
        assert(schemas, 'Schema service is required')
        assert(attributes, 'Attribute service is required')

        log.info(`Enabling account ${input.identity}...`)

        await sources.fetchAllSources()
        await schemas.setFusionAccountSchema(input.schema)

        await sources.fetchFusionAccounts()
        await fusion.processFusionAccounts()

        const fusionAccount = fusion.getFusionAccountByNativeIdentity(input.identity)
        assert(fusionAccount, `Fusion account not found for identity: ${input.identity}`)
        await attributes.refreshAttributes(fusionAccount, true)

        log.debug(`Enabling fusion account: ${fusionAccount.name || fusionAccount.nativeIdentity}`)
        fusionAccount.enable()

        const iscAccount = await fusion.getISCAccount(fusionAccount)
        assert(iscAccount, 'Failed to generate ISC account from fusion account')

        res.send(iscAccount)
        log.info(`Account ${input.identity} enable completed`)
    } catch (error) {
        log.crash(`Failed to enable account ${input.identity}`, error)
    }
}
