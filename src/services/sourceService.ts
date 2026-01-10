import {
    Search,
    Schema,
    Account,
    AccountsApiListAccountsRequest,
    SourcesApiGetSourceSchemasRequest,
    SearchApiSearchPostRequest,
    SourcesV2025ApiImportAccountsRequest,
    TaskManagementV2025ApiGetTaskStatusRequest,
    AccountsApiGetAccountRequest,
    SourcesApiUpdateSourceRequest,
    Source,
} from 'sailpoint-api-client'
import { BaseConfig, FusionConfig, SourceConfig } from '../model/config'
import { ClientService } from './clientService'
import { LogService } from './logService'
import { assert, softAssert } from '../utils/assert'
import { getDateFromISOString } from '../utils/date'

/**
 * Service for managing sources, source discovery, and aggregation coordination.
 * Handles all source-related operations including finding the fusion source,
 * managing managed sources, and coordinating aggregations.
 */
type SourceInfo = {
    id: string
    name: string
    isManaged: boolean
    config?: SourceConfig // Only present for managed sources
}

export class SourceService {
    // Unified source storage - both managed and fusion sources
    private sourcesById: Map<string, SourceInfo> = new Map()
    private sourcesByName: Map<string, SourceInfo> = new Map()
    private _allSources?: SourceInfo[]
    private fusionLatestAggregationDate: Date | undefined

    // Account caching
    public managedAccountsById: Map<string, Account> = new Map()
    public managedAccountsByName: Map<string, Account> = new Map()
    private managedAccounts?: Account[]

    public fusionAccountsByNativeIdentity: Map<string, Account> = new Map()
    public fusionAccountsByName: Map<string, Account> = new Map()
    private _fusionAccounts?: Account[]

    constructor(
        private config: FusionConfig,
        private log: LogService,
        private client: ClientService
    ) {}

    /**
     * Get fusion source ID
     */
    public get fusionSourceId(): string {
        const fusionSource = this.getFusionSource()
        assert(fusionSource, 'Fusion source not found')
        return fusionSource.id
    }

    /**
     * Get fusion source info
     */
    public getFusionSource(): SourceInfo | undefined {
        return Array.from(this.sourcesById.values()).find((s) => !s.isManaged)
    }

    /**
     * Get all managed sources
     */
    public get managedSources(): SourceInfo[] {
        assert(this._allSources, 'Sources have not been loaded')
        return this._allSources.filter((s) => s.isManaged)
    }

    /**
     * Get all sources (managed + fusion)
     */
    public get allSources(): SourceInfo[] {
        assert(this._allSources, 'Sources have not been loaded')
        return this._allSources
    }

    // public get managedAccounts(): Account[] {
    //     assert(this.managedAccounts, 'Managed accounts have not been loaded')
    //     return this.managedAccounts
    // }

    public get fusionAccounts(): Account[] {
        assert(this._fusionAccounts, 'Fusion accounts have not been loaded')
        return this._fusionAccounts
    }

    public async fetchAllSources(): Promise<void> {
        this.log.debug('Fetching all sources')
        const { sourcesApi } = this.client
        const listSources = async () => {
            return await sourcesApi.listSources()
        }
        const apiSources = await this.client.paginate(listSources)
        assert(apiSources.length > 0, 'Sources not found')

        // Build unified source info from SourceConfig + API IDs
        const resolvedSources: SourceInfo[] = []

        // Add managed sources (from config.sources)
        for (const sourceConfig of this.config.sources) {
            const apiSource = apiSources.find((x) => x.name === sourceConfig.name)
            assert(apiSource, `Unable to find source: ${sourceConfig.name}`)
            resolvedSources.push({
                id: apiSource.id!,
                name: apiSource.name!,
                isManaged: true,
                config: sourceConfig,
            })
        }

        // Find and add fusion source
        const fusionSource = apiSources.find(
            (x) => (x.connectorAttributes as BaseConfig).spConnectorInstanceId === this.config.spConnectorInstanceId
        )
        assert(fusionSource, 'Fusion source not found')
        assert(fusionSource.owner, 'Fusion source owner not found')

        resolvedSources.push({
            id: fusionSource.id!,
            name: fusionSource.name!,
            isManaged: false,
            config: undefined, // Fusion source has no SourceConfig
        })

        this._allSources = resolvedSources
        this.sourcesById = new Map(resolvedSources.map((x) => [x.id, x]))
        this.sourcesByName = new Map(resolvedSources.map((x) => [x.name, x]))

        const managedCount = resolvedSources.filter((s) => s.isManaged).length
        this.log.debug(`Fetched ${managedCount} managed source(s) and fusion source: ${fusionSource.name}`)
    }

    /**
     * Get source info by ID
     */
    public getSourceById(id: string): SourceInfo | undefined {
        return this.sourcesById.get(id)
    }

    /**
     * Get source info by name
     */
    public getSourceByName(name: string): SourceInfo | undefined {
        return this.sourcesByName.get(name)
    }

    /**
     * Get source configuration by source name (only for managed sources)
     */
    public getSourceConfig(sourceName: string): SourceConfig | undefined {
        const sourceInfo = this.sourcesByName.get(sourceName)
        return sourceInfo?.config ?? this.config.sources.find((sc) => sc.name === sourceName)
    }

    /**
     * Get account filter for a source
     */
    public getAccountFilter(sourceName: string): string | undefined {
        return this.getSourceConfig(sourceName)?.accountFilter
    }

    /**
     * Fetch all accounts for a given source ID, applying SourceConfig.accountFilter if present (for managed sources).
     */
    public async fetchSourceAccountsById(sourceId: string): Promise<Account[]> {
        const { accountsApi } = this.client
        const sourceInfo = this.sourcesById.get(sourceId)
        assert(sourceInfo, `Source not found for id: ${sourceId}`)

        // Build filter: start with sourceId filter
        let filters = `sourceId eq "${sourceId}"`

        // Add account filter from SourceConfig if configured (only for managed sources)
        if (sourceInfo.isManaged && sourceInfo.config?.accountFilter) {
            filters = `(${filters}) and (${sourceInfo.config.accountFilter})`
        }

        const requestParameters: AccountsApiListAccountsRequest = {
            filters,
        }

        const listAccounts = async (params: AccountsApiListAccountsRequest) => {
            return await accountsApi.listAccounts(params)
        }
        return await this.client.paginate<Account, AccountsApiListAccountsRequest>(listAccounts, requestParameters)
    }

    /**
     * Fetch and cache fusion accounts
     */
    public async fetchFusionAccounts(): Promise<void> {
        this.log.debug('Fetching fusion accounts')
        this._fusionAccounts = await this.fetchSourceAccountsById(this.fusionSourceId)
        this.fusionAccountsByNativeIdentity = new Map(
            this._fusionAccounts.map((account) => [account.nativeIdentity!, account])
        )
        this.fusionAccountsByName = new Map(this._fusionAccounts.map((account) => [account.name!, account]))
        this.log.debug(`Fetched ${this._fusionAccounts.length} fusion account(s)`)
    }

    /**
     * Fetch and cache managed accounts from all managed sources
     */
    public async fetchManagedAccounts(): Promise<void> {
        this.log.debug(`Fetching managed accounts from ${this.managedSources.length} source(s)`)
        this.managedAccounts = (
            await Promise.all(this.managedSources.map((s) => this.fetchSourceAccountsById(s.id)))
        ).flat()
        this.managedAccountsById = new Map(this.managedAccounts.map((account) => [account.id!, account]))
        this.managedAccountsByName = new Map(this.managedAccounts.map((account) => [account.name!, account]))
        this.log.debug(`Fetched ${this.managedAccounts.length} managed account(s)`)
    }

    private async fetchAccountById(id: string): Promise<Account | undefined> {
        const { accountsApi } = this.client
        const requestParameters: AccountsApiGetAccountRequest = {
            id,
        }
        const getAccount = async () => {
            return await accountsApi.getAccount(requestParameters)
        }
        const response = await this.client.execute(getAccount)
        return response.data ?? undefined
    }

    /**
     * Fetch and cache a single fusion account by nativeIdentity
     */
    public async fetchFusionAccount(nativeIdentity: string): Promise<void> {
        this.log.debug('Fetching fusion account')
        const fusionAccount = await this.fetchSourceAccountByNativeIdentity(this.fusionSourceId, nativeIdentity)
        assert(fusionAccount, 'Fusion account not found')
        if (!this._fusionAccounts) {
            this._fusionAccounts = []
        }
        this._fusionAccounts.push(fusionAccount)

        if (!this.fusionAccountsByNativeIdentity) {
            this.fusionAccountsByNativeIdentity = new Map()
        }
        this.fusionAccountsByNativeIdentity.set(fusionAccount.nativeIdentity!, fusionAccount)

        if (!this.fusionAccountsByName) {
            this.fusionAccountsByName = new Map()
        }
        this.fusionAccountsByName.set(fusionAccount.name!, fusionAccount)
        this.log.debug(`Fetched fusion account: ${fusionAccount.name}`)
    }

    /**
     * Fetch and cache a single managed account by nativeIdentity
     */
    public async fetchManagedAccount(id: string): Promise<void> {
        const managedAccount = await this.fetchAccountById(id)
        assert(managedAccount, 'Managed account not found')
        if (!this.managedAccounts) {
            this.managedAccounts = []
        }
        this.managedAccounts.push(managedAccount)

        if (!this.managedAccountsById) {
            this.managedAccountsById = new Map()
        }
        this.managedAccountsById.set(managedAccount.id!, managedAccount)

        if (!this.managedAccountsByName) {
            this.managedAccountsByName = new Map()
        }
        this.managedAccountsByName.set(managedAccount.name!, managedAccount)
    }

    /**
     * Fetch a single account for a given source ID and nativeIdentity, applying SourceConfig.accountFilter if present (for managed sources).
     */
    public async fetchSourceAccountByNativeIdentity(
        sourceId: string,
        nativeIdentity: string
    ): Promise<Account | undefined> {
        const { accountsApi } = this.client
        const sourceInfo = this.sourcesById.get(sourceId)
        assert(sourceInfo, `Source not found for id: ${sourceId}`)

        // Start with sourceId + nativeIdentity filter
        let filters = `sourceId eq "${sourceId}" and nativeIdentity eq "${nativeIdentity}"`

        // Add account filter from SourceConfig if configured (only for managed sources)
        if (sourceInfo.isManaged && sourceInfo.config?.accountFilter) {
            filters = `(${filters}) AND (${sourceInfo.config.accountFilter})`
        }

        const requestParameters: AccountsApiListAccountsRequest = {
            filters,
        }

        const listAccounts = async () => {
            return await accountsApi.listAccounts(requestParameters)
        }

        const response = await this.client.execute(listAccounts)
        const accounts = response.data ?? []
        return accounts[0]
    }

    /**
     * Get latest aggregation date for a source (only for managed sources)
     */
    public async getLatestAggregationDate(sourceId: string): Promise<Date> {
        const source = this.sourcesById.get(sourceId)
        assert(source, 'Source not found')
        const sourceName = source.name

        const { searchApi } = this.client
        const search: Search = {
            indices: ['events'],
            query: {
                query: `operation:AGGREGATE AND status:PASSED AND objects:ACCOUNT AND target.name.exact:"${sourceName} [source]"`,
            },
            sort: ['-created'],
        }

        const requestParameters: SearchApiSearchPostRequest = { search, limit: 1 }
        const searchPost = async () => {
            const response = await searchApi.searchPost(requestParameters)
            return response.data ?? []
        }
        const response = await this.client.execute(searchPost)

        const latestAggregation = getDateFromISOString(response[0]?.created)

        return latestAggregation
    }

    /**
     * Check if a managed source should be aggregated based on fusion aggregation date
     */
    private async shouldAggregateSource(source: SourceInfo): Promise<boolean> {
        assert(source.isManaged, 'Only managed sources can be aggregated')
        if (!this.fusionLatestAggregationDate) {
            this.fusionLatestAggregationDate = await this.getLatestAggregationDate(this.fusionSourceId)
        }

        const latestSourceDate = await this.getLatestAggregationDate(source.id)
        return this.fusionLatestAggregationDate! > latestSourceDate
    }

    /**
     * Aggregate a source
     */
    public async aggregateSourceAccounts(sourceId: string): Promise<void> {
        await this.aggregateAccounts(sourceId)
    }

    private async aggregateAccounts(id: string): Promise<void> {
        let completed = false
        const { sourcesV2025Api, taskManagementApi } = this.client
        const requestParameters: SourcesV2025ApiImportAccountsRequest = {
            id,
        }
        const importAccounts = async () => {
            const response = await sourcesV2025Api.importAccounts(requestParameters)
            return response.data
        }
        const response = await this.client.execute(importAccounts)

        // Use global retry settings for aggregation task polling
        const taskResultRetries = this.config.taskResultRetries
        const taskResultWait = this.config.taskResultWait

        let count = taskResultRetries
        while (--count > 0) {
            const requestParameters: TaskManagementV2025ApiGetTaskStatusRequest = {
                id: response.task?.id ?? '',
            }
            const getTaskStatus = async () => {
                const response = await taskManagementApi.getTaskStatus(requestParameters)
                return response.data
            }
            const result = await this.client.execute(getTaskStatus)

            if (result.completed) {
                completed = true
                break
            } else {
                await new Promise((resolve) => setTimeout(resolve, taskResultWait))
            }
        }
        softAssert(completed, 'Failed to aggregate managed accounts')
    }

    public async listSourceSchemas(sourceId: string): Promise<Schema[]> {
        const { sourcesApi } = this.client
        const requestParameters: SourcesApiGetSourceSchemasRequest = {
            sourceId,
        }
        const getSourceSchemas = async () => {
            const response = await sourcesApi.getSourceSchemas(requestParameters)
            return response.data ?? []
        }
        const response = await this.client.execute(getSourceSchemas)
        return response
    }

    public async aggregateManagedSources(): Promise<void> {
        const managedSources = this.managedSources
        this.log.debug(`Checking aggregation status for ${managedSources.length} managed source(s)`)
        const aggregationPromises = []
        for (const source of managedSources) {
            const sourceConfig = source.config
            const forceAggregation = sourceConfig?.forceAggregation ?? false

            if (!forceAggregation) {
                this.log.debug(`Force aggregation is disabled for source ${source.name}, skipping`)
                continue
            }

            const shouldAggregate = await this.shouldAggregateSource(source)
            if (shouldAggregate) {
                this.log.info(`Aggregating source: ${source.name}`)
                aggregationPromises.push(this.aggregateSourceAccounts(source.id))
            } else {
                this.log.debug(`Source ${source.name} does not need aggregation`)
            }
        }

        await Promise.all(aggregationPromises)
        this.log.debug('Source aggregation completed')
    }

    public async patchSourceConfig(id: string, requestParameters: SourcesApiUpdateSourceRequest): Promise<Source> {
        const { sourcesApi } = this.client
        const updateSource = async () => {
            const response = await sourcesApi.updateSource(requestParameters)
            return response.data
        }
        return await this.client.execute(updateSource)
    }
}
