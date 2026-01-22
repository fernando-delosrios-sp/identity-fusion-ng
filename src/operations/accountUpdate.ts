import { Response, StdAccountUpdateInput, StdAccountUpdateOutput } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'
import { fetchFusionAccount } from './helpers/fetchFusionAccount'
import { assert } from '../utils/assert'
import { reportAction } from './actions/reportAction'
import { fusionAction } from './actions/fusionAction'
import { correlateAction } from './actions/correlateAction'

export const accountUpdate = async (
    serviceRegistry: ServiceRegistry,
    input: StdAccountUpdateInput,
    res: Response<StdAccountUpdateOutput>
) => {
    ServiceRegistry.setCurrent(serviceRegistry)
    const { log, sources, schemas, fusion } = serviceRegistry

    try {
        assert(input, 'Account update input is required')
        assert(input.identity, 'Account identity is required')
        assert(input.changes, 'Account changes are required')
        assert(Array.isArray(input.changes), 'Account changes must be an array')
        assert(input.changes.length > 0, 'At least one change is required')
        assert(serviceRegistry, 'Service registry is required')
        assert(log, 'Log service is required')
        assert(sources, 'Source service is required')
        assert(schemas, 'Schema service is required')
        assert(fusion, 'Fusion service is required')

        log.info(`Updating account ${input.identity}...`)

        await sources.fetchAllSources()
        await schemas.setFusionAccountSchema(input.schema)
        log.debug('Fusion account schema set successfully')

        const fusionAccount = await fetchFusionAccount(input.identity, serviceRegistry)
        assert(fusionAccount, `Fusion account not found for identity: ${input.identity}`)
        log.debug(`Found fusion account: ${fusionAccount.name || fusionAccount.nativeIdentity}`)

        log.debug(`Processing ${input.changes.length} change(s)`)
        for (const change of input.changes) {
            assert(change.attribute, 'Change attribute is required')

            if (change.attribute === 'actions') {
                switch (change.value) {
                    case 'report':
                        await reportAction(fusionAccount, change.op)
                        break
                    case 'fusion':
                        await fusionAction(fusionAccount, change.op)
                        break
                    case 'correlated':
                        await correlateAction(fusionAccount, change.op)
                        // Status/action will be updated after correlation promises resolve in getISCAccount
                        break
                    default:
                        log.crash(`Unsupported action: ${change.value}`)
                }
            } else {
                log.crash(`Unsupported entitlement change: ${change.attribute}`)
            }
        }

        const iscAccount = await fusion.getISCAccount(fusionAccount)
        assert(iscAccount, 'Failed to generate ISC account from fusion account')

        res.send(iscAccount)
        log.info(`Account ${input.identity} update completed successfully`)
    } catch (error) {
        log.crash(`Failed to update account ${input.identity}`, error)
    }
}
