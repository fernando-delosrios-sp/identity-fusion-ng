import { Response, StdAccountReadInput, StdAccountReadOutput } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'
import { fetchFusionAccount } from './fetchFusionAccount'
import { assert } from '../utils/assert'

export const accountRead = async (
    serviceRegistry: ServiceRegistry,
    input: StdAccountReadInput,
    res: Response<StdAccountReadOutput>
) => {
    ServiceRegistry.setCurrent(serviceRegistry)
    const { log, fusion, schemas } = serviceRegistry

    try {
        log.info(`Reading account ${input.identity}...`)
        await schemas.setFusionAccountSchema(input.schema)

        const fusionAccount = await fetchFusionAccount(input.identity, serviceRegistry)
        assert(fusionAccount, 'Fusion account not found')
        const iscAccount = fusion.getISCAccount(fusionAccount)
        res.send(iscAccount)

        log.info(`Account ${input.identity} read completed`)
    } catch (error) {
        log.crash(`Failed to read account ${input.identity}`, error)
    }
}
