import { AccountSchema } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'
import { assert } from './assert'
import { FusionAccount } from '../model/account'

export const fetchFusionAccount = async (id: string, schema?: AccountSchema): Promise<FusionAccount> => {
    const serviceRegistry = ServiceRegistry.getCurrent()
    const { fusion, accounts, identities, schemas, sources } = serviceRegistry

    await schemas.setFusionAccountSchema(schema)
    await sources.fetchAllSources()
    await accounts.fetchFusionAccount(id)
    const account = accounts.fusionAccountsById.get(id)
    const fusionAccount = accounts.fusionAccountsById.get(id)
    assert(fusionAccount, 'Fusion account not found')
    assert(fusionAccount.identityId, 'Identity ID not found')
    await identities.fetchIdentityById(fusionAccount.identityId)
    assert(account, 'Account ${id} not found')
    return await fusion.processFusionAccount(account)
}
