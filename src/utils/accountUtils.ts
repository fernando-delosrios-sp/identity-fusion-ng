import { FusionAccount } from '../model/account'

/**
 * Utility functions for account identifier extraction and manipulation
 */

/**
 * Extract account identifier from a fusion account using multiple fallback strategies
 * Tries in order:
 * 1. managedAccountId
 * 2. nativeIdentity
 * 3. attributes.id
 * 4. attributes.uuid
 * 5. identityId
 * 6. 'unknown' as final fallback
 */
export const extractAccountIdentifier = (fusionAccount: FusionAccount): string => {
    return (
        String(fusionAccount.managedAccountId || '').trim() ||
        String(fusionAccount.nativeIdentityOrUndefined || '').trim() ||
        String((fusionAccount.attributes as any)?.id || '').trim() ||
        String((fusionAccount.attributes as any)?.uuid || '').trim() ||
        String(fusionAccount.identityId || '').trim() ||
        'unknown'
    )
}

/**
 * Extract account name from a fusion account using multiple fallback strategies
 */
export const extractAccountName = (fusionAccount: FusionAccount): string => {
    return (
        fusionAccount.name ||
        fusionAccount.displayName ||
        fusionAccount.nativeIdentityOrUndefined ||
        extractAccountIdentifier(fusionAccount)
    )
}
