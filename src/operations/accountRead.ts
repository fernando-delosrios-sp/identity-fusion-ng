import { Response, StdAccountReadInput, StdAccountReadOutput } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'
import { fetchFusionAccount } from '../utils/account'
import { assert } from '../utils/assert'

export const accountRead = async (
    serviceRegistry: ServiceRegistry,
    input: StdAccountReadInput,
    res: Response<StdAccountReadOutput>
) => {
    ServiceRegistry.setCurrent(serviceRegistry)
    const { log, fusion } = serviceRegistry

    try {
        log.info(`Reading account ${input.identity}...`)

        const fusionAccount = await fetchFusionAccount(input.identity, input.schema)
        assert(fusionAccount, 'Fusion account not found')

        fusion.listISCAccounts().forEach((x) => res.send(x))

        log.info(`Account ${input.identity} read completed`)
    } catch (error) {
        log.crash(`Failed to read account ${input.identity}`, error)
    }
}
