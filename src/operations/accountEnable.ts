import { Response, StdAccountEnableInput, StdAccountEnableOutput } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'
import { fetchFusionAccount } from './helpers/fetchFusionAccount'
import { assert } from '../utils/assert'

export const accountEnable = async (
    serviceRegistry: ServiceRegistry,
    input: StdAccountEnableInput,
    res: Response<StdAccountEnableOutput>
) => {
    ServiceRegistry.setCurrent(serviceRegistry)
    const { log, fusion, sources, schemas } = serviceRegistry

    try {
        log.info(`Enabling account ${input.identity}...`)
        assert(input.identity, 'Account identity is required')

        await sources.fetchAllSources()
        await schemas.setFusionAccountSchema(input.schema)

        const fusionAccount = await fetchFusionAccount(input.identity, serviceRegistry)
        assert(fusionAccount, `Fusion account not found for identity: ${input.identity}`)

        log.debug(`Enabling fusion account: ${fusionAccount.name || fusionAccount.nativeIdentity}`)
        fusionAccount.enable()

        const iscAccount = fusion.getISCAccount(fusionAccount)
        assert(iscAccount, 'Failed to generate ISC account from fusion account')

        res.send(iscAccount)
        log.info(`Account ${input.identity} enable completed`)
    } catch (error) {
        log.crash(`Failed to enable account ${input.identity}`, error)
    }
}
