import { Account, AccountsApiGetAccountRequest, AccountsApiListAccountsRequest } from 'sailpoint-api-client'
import { ClientService } from './clientService'
import { LogService } from './logService'
import { SourceService } from './sourceService'
import { assert } from '../utils/assert'

/**
 * Service for managing accounts, account correlation, and account-identity relationships.
 */
export class AccountService {
    public managedAccountsById: Map<string, Account> = new Map() // TODO: Use assertion + getter instead
    public managedAccountsByName: Map<string, Account> = new Map()
    private _managedAccounts?: Account[]

    public fusionAccountsById: Map<string, Account> = new Map()
    public fusionAccountsByName: Map<string, Account> = new Map()
    private _fusionAccounts?: Account[]

    constructor(
        private log: LogService,
        private client: ClientService,
        private sources: SourceService
    ) {}

    public get managedAccounts(): Account[] {
        assert(this._managedAccounts, 'Managed accounts have not been loaded')
        return this._managedAccounts
    }

    public get fusionAccounts(): Account[] {
        assert(this._fusionAccounts, 'Fusion accounts have not been loaded')
        return this._fusionAccounts
    }

    private async fetchSourceAccounts(sourceId: string): Promise<Account[]> {
        const { accountsApi } = this.client
        const requestParameters: AccountsApiListAccountsRequest = {
            filters: `sourceId eq "${sourceId}"`,
        }

        const listAccounts = async (params: AccountsApiListAccountsRequest) => {
            return await accountsApi.listAccounts(params)
        }
        return await this.client.paginate(listAccounts, requestParameters)
    }

    private async fetchSourceAccount(sourceId: string, accountId: string): Promise<Account | undefined> {
        const { accountsApi } = this.client
        const requestParameters: AccountsApiGetAccountRequest = {
            id: accountId,
        }
        const getAccount = async (): Promise<Account | undefined> => {
            const response = await accountsApi.getAccount(requestParameters)
            if (response.status !== 200) {
                return undefined
            }
            return response.data
        }
        const response = await this.client.execute(getAccount)
        return response
    }

    public async fetchFusionAccounts(): Promise<void> {
        this.log.debug('Fetching fusion accounts')
        this._fusionAccounts = await this.fetchSourceAccounts(this.sources.fusionSourceId)
        this.fusionAccountsById = new Map(this._fusionAccounts.map((account) => [account.id!, account]))
        this.fusionAccountsByName = new Map(this._fusionAccounts.map((account) => [account.name!, account]))
        this.log.debug(`Fetched ${this._fusionAccounts.length} fusion account(s)`)
    }

    public async fetchManagedAccounts(): Promise<void> {
        const { managedSources } = this.sources
        this.log.debug(`Fetching managed accounts from ${managedSources.length} source(s)`)
        this._managedAccounts = (await Promise.all(managedSources.map((s) => this.fetchSourceAccounts(s.id!)))).flat()
        this.managedAccountsById = new Map(this._managedAccounts.map((account) => [account.id!, account]))
        this.managedAccountsByName = new Map(this._managedAccounts.map((account) => [account.name!, account]))
        this.log.debug(`Fetched ${this._managedAccounts.length} managed account(s)`)
    }

    public async fetchFusionAccount(id: string): Promise<void> {
        this.log.debug('Fetching fusion account')
        const fusionSource = await this.sources.getFusionSource()
        const fusionAccount = await this.fetchSourceAccount(fusionSource!.id!, id)
        assert(fusionAccount, 'Fusion account not found')
        this._fusionAccounts = [fusionAccount]
        this.fusionAccountsById = new Map(this._fusionAccounts.map((account) => [account.id!, account]))
        this.fusionAccountsByName = new Map(this._fusionAccounts.map((account) => [account.name!, account]))
        this.log.debug(`Fetched fusion account: ${fusionAccount.name}`)
    }

    public async fetchManagedAccount(id: string): Promise<void> {
        const { managedSources } = this.sources
        const managedAccount = await this.fetchSourceAccount(managedSources[0].id!, id)
        assert(managedAccount, 'Managed account not found')
        this._managedAccounts = [managedAccount]
        this.managedAccountsById = new Map(this._managedAccounts.map((account) => [account.id!, account]))
        this.managedAccountsByName = new Map(this._managedAccounts.map((account) => [account.name!, account]))
    }
}
