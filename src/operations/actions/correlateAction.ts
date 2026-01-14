import { AttributeChangeOp } from '@sailpoint/connector-sdk'
import { FusionAccount } from '../../model/account'
import { ServiceRegistry } from '../../services/serviceRegistry'

/**
 * Placeholder function for correlate action
 * Correlates missing source accounts
 */
export const correlateAction = async (fusionAccount: FusionAccount, op: AttributeChangeOp): Promise<void> => {
    const serviceRegistry = ServiceRegistry.getCurrent()
    const { log, identities } = serviceRegistry

    log.debug(`Correlate action called for account ${fusionAccount.name} with operation ${op}`)

    // TODO: Implement correlate action logic
    if (op === AttributeChangeOp.Add) {
        await identities.correlateAccounts(fusionAccount)
    }
}
