import { AttributeChangeOp } from '@sailpoint/connector-sdk'
import { FusionAccount } from '../../model/account'
import { generateReport } from '../helpers/generateReport'

/**
 * Placeholder function for report action
 * Generates fusion report
 */
export const reportAction = async (fusionAccount: FusionAccount, op: AttributeChangeOp): Promise<void> => {
    if (op === AttributeChangeOp.Add) {
        await generateReport(fusionAccount)
    }
}
