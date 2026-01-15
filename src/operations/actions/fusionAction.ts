import { AttributeChangeOp } from '@sailpoint/connector-sdk'
import { FusionAccount } from '../../model/account'
import { ServiceRegistry } from '../../services/serviceRegistry'

/**
 * Placeholder function for fusion action
 * Creates a fusion account
 */
export const fusionAction = async (fusionAccount: FusionAccount, op: AttributeChangeOp): Promise<void> => {
    const serviceRegistry = ServiceRegistry.getCurrent()
    const { log } = serviceRegistry

    log.debug(`Fusion action called for account ${fusionAccount.name} with operation ${op}`)

    // TODO: Implement fusion action logic
    if (op === AttributeChangeOp.Add) {
        // fusionAccount.actions.add('fusion')
    } else if (op === AttributeChangeOp.Remove) {
        // fusionAccount.actions.delete('fusion')
    }
}
