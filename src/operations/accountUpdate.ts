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
        log.info(`Updating account ${input.identity}...`)
        assert(input.identity, 'Account identity is required')
        assert(input.schema, 'Account schema is required')
        assert(input.changes, 'Account changes are required')
        assert(input.changes.length > 0, 'At least one change is required')

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
                const actions = [...(change.value ?? [])]
                assert(actions.length > 0, 'Actions array cannot be empty')
                log.debug(`Processing ${actions.length} action(s) with operation: ${change.op}`)

                for (const action of actions) {
                    assert(action, 'Action value is required')
                    log.debug(`Processing action: ${action} with operation: ${change.op}`)

                    switch (action) {
                        case 'report':
                            await reportAction(fusionAccount, change.op)
                            break
                        case 'fusion':
                            await fusionAction(fusionAccount, change.op)
                            break
                        case 'correlate':
                            await correlateAction(fusionAccount, change.op)
                            break
                        default:
                            log.crash(`Unsupported action: ${action}`)
                    }
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
