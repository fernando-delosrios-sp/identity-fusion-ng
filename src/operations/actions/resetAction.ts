import { AttributeChangeOp } from '@sailpoint/connector-sdk'
import { FusionAccount } from '../../model/account'
import { ServiceRegistry } from '../../services/serviceRegistry'

/**
 * Placeholder function for reset action
 * Resets the account's unique ID
 */
export const resetAction = async (fusionAccount: FusionAccount, op: AttributeChangeOp): Promise<void> => {
    const serviceRegistry = ServiceRegistry.getCurrent()
    const { log } = serviceRegistry

    log.debug(`Reset action called for account ${fusionAccount.name} with operation ${op}`)

    // TODO: Implement reset action logic
    if (op === AttributeChangeOp.Add) {
        fusionAccount.actions.add('reset')
    } else if (op === AttributeChangeOp.Remove) {
        fusionAccount.actions.delete('reset')
    }
}
