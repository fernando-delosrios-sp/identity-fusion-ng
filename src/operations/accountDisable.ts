import { Response, StdAccountDisableInput, StdAccountDisableOutput } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'
import { fetchFusionAccount } from '../utils/account'
import { assert } from '../utils/assert'

export const accountDisable = async (
    serviceRegistry: ServiceRegistry,
    input: StdAccountDisableInput,
    res: Response<StdAccountDisableOutput>
) => {
    ServiceRegistry.setCurrent(serviceRegistry)
    const { log, fusion } = serviceRegistry

    try {
        log.info(`Reading account ${input.identity}...`)

        const fusionAccount = await fetchFusionAccount(input.identity, input.schema)
        assert(fusionAccount, 'Fusion account not found')
        fusionAccount.disable()

        fusion.listISCAccounts().forEach(res.send)

        log.info(`Account ${input.identity} read completed`)
    } catch (error) {
        log.crash(`Failed to read account ${input.identity}`, error)
    }
}
