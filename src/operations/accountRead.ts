import { Response, StdAccountReadInput, StdAccountReadOutput } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'
import { fetchFusionAccount } from './helpers/fetchFusionAccount'
import { assert } from '../utils/assert'

export const accountRead = async (
    serviceRegistry: ServiceRegistry,
    input: StdAccountReadInput,
    res: Response<StdAccountReadOutput>
) => {
    ServiceRegistry.setCurrent(serviceRegistry)
    const { log, fusion, schemas, sources } = serviceRegistry

    try {
        assert(input, 'Account read input is required')
        assert(input.identity, 'Account identity is required')
        assert(serviceRegistry, 'Service registry is required')
        assert(log, 'Log service is required')
        assert(fusion, 'Fusion service is required')
        assert(schemas, 'Schema service is required')
        assert(sources, 'Source service is required')

        log.info(`Reading account ${input.identity}...`)

        await sources.fetchAllSources()
        await schemas.setFusionAccountSchema(input.schema)

        const fusionAccount = await fetchFusionAccount(input.identity, serviceRegistry)
        assert(fusionAccount, `Fusion account not found for identity: ${input.identity}`)

        log.debug(`Found fusion account: ${fusionAccount.name || fusionAccount.nativeIdentity}`)
        const iscAccount = await fusion.getISCAccount(fusionAccount)
        assert(iscAccount, 'Failed to generate ISC account from fusion account')

        res.send(iscAccount)
        log.info(`Account ${input.identity} read completed`)
    } catch (error) {
        log.crash(`Failed to read account ${input.identity}`, error)
    }
}
