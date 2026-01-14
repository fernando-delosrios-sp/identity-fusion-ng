import { ServiceRegistry } from '../../services/serviceRegistry'
import { assert } from '../../utils/assert'
import { FusionAccount } from '../../model/account'

export const fetchFusionAccount = async (
    nativeIdentity: string,
    serviceRegistry?: ServiceRegistry
): Promise<FusionAccount> => {
    if (!serviceRegistry) {
        serviceRegistry = ServiceRegistry.getCurrent()
    }
    const { fusion, identities, sources } = serviceRegistry

    await sources.fetchFusionAccount(nativeIdentity)
    const fusionAccountsMap = sources.fusionAccountsByNativeIdentity
    assert(fusionAccountsMap, 'Fusion accounts have not been loaded')
    const account = fusionAccountsMap.get(nativeIdentity)
    assert(account, 'Fusion account not found')
    assert(account.identityId, 'Identity ID not found')
    await identities.fetchIdentityById(account.identityId)
    await Promise.all(
        account.attributes?.accounts?.map(async (id: string) => {
            await sources.fetchManagedAccount(id)
        }) ?? []
    )
    // Get the map reference to pass to processFusionAccount
    const managedAccountsMap = sources.managedAccountsById
    assert(managedAccountsMap, 'Managed accounts have not been loaded')
    return await fusion.processFusionAccount(account)
}
