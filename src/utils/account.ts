import { AccountSchema } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'
import { assert } from './assert'
import { FusionAccount } from '../model/account'

export const fetchFusionAccount = async (nativeIdentity: string, schema?: AccountSchema): Promise<FusionAccount> => {
    const serviceRegistry = ServiceRegistry.getCurrent()
    const { fusion, identities, schemas, sources } = serviceRegistry

    await sources.fetchAllSources()
    await schemas.setFusionAccountSchema(schema)
    await sources.fetchFusionAccount(nativeIdentity)
    const account = sources.fusionAccountsByNativeIdentity.get(nativeIdentity)
    assert(account, 'Fusion account not found')
    assert(account.identityId, 'Identity ID not found')
    await identities.fetchIdentityById(account.identityId)
    await Promise.all(
        account.attributes?.accounts?.map(async (id: string) => {
            await sources.fetchManagedAccount(id)
        }) ?? []
    )
    return await fusion.processFusionAccount(account)
}
