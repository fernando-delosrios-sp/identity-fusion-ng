import { Response, StdAccountDisableInput, StdAccountDisableOutput } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'
import { fetchFusionAccount } from './helpers/fetchFusionAccount'
import { assert } from '../utils/assert'

export const accountDisable = async (
    serviceRegistry: ServiceRegistry,
    input: StdAccountDisableInput,
    res: Response<StdAccountDisableOutput>
) => {
    ServiceRegistry.setCurrent(serviceRegistry)
    const { log, fusion, sources, schemas } = serviceRegistry

    try {
        assert(input, 'Account disable input is required')
        assert(input.identity, 'Account identity is required')
        assert(serviceRegistry, 'Service registry is required')
        assert(log, 'Log service is required')
        assert(fusion, 'Fusion service is required')
        assert(sources, 'Source service is required')
        assert(schemas, 'Schema service is required')

        log.info(`Disabling account ${input.identity}...`)

        await sources.fetchAllSources()
        await schemas.setFusionAccountSchema(input.schema)

        const fusionAccount = await fetchFusionAccount(input.identity, serviceRegistry)
        assert(fusionAccount, `Fusion account not found for identity: ${input.identity}`)

        log.debug(`Disabling fusion account: ${fusionAccount.name || fusionAccount.nativeIdentity}`)
        fusionAccount.disable()

        const iscAccount = await fusion.getISCAccount(fusionAccount)
        assert(iscAccount, 'Failed to generate ISC account from fusion account')

        res.send(iscAccount)
        log.info(`Account ${input.identity} disable completed`)
    } catch (error) {
        log.crash(`Failed to disable account ${input.identity}`, error)
    }
}
