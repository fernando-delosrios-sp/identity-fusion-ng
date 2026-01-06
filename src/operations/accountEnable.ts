import { Response, StdAccountEnableInput, StdAccountEnableOutput } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'
import { fetchFusionAccount } from '../utils/account'
import { assert } from '../utils/assert'

export const accountEnable = async (
    serviceRegistry: ServiceRegistry,
    input: StdAccountEnableInput,
    res: Response<StdAccountEnableOutput>
) => {
    ServiceRegistry.setCurrent(serviceRegistry)
    const { log, fusion } = serviceRegistry

    try {
        log.info(`Reading account ${input.identity}...`)

        const fusionAccount = await fetchFusionAccount(input.identity, input.schema)
        assert(fusionAccount, 'Fusion account not found')
        fusionAccount.enable()

        fusion.listISCAccounts().forEach(res.send)

        log.info(`Account ${input.identity} read completed`)
    } catch (error) {
        log.crash(`Failed to read account ${input.identity}`, error)
    }
}
