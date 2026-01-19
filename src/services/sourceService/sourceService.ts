import {
    Search,
    Account,
    AccountsApiListAccountsRequest,
    SearchApiSearchPostRequest,
    SourcesV2025ApiImportAccountsRequest,
    TaskManagementV2025ApiGetTaskStatusRequest,
    AccountsApiGetAccountRequest,
    Source,
    SourcesV2025ApiUpdateSourceRequest,
    SchemaV2025,
    SourcesV2025ApiGetSourceSchemasRequest,
    OwnerDto,
    SourcesV2025ApiListSourcesRequest,
} from 'sailpoint-api-client'
import { BaseConfig, FusionConfig, SourceConfig } from '../../model/config'
import { ClientService } from '../clientService'
import { LogService } from '../logService'
import { assert, softAssert } from '../../utils/assert'
import { getDateFromISOString } from '../../utils/date'
import { SourceInfo } from './types'

// ============================================================================
// SourceService Class
// ============================================================================

/**
 * Service for managing sources, source discovery, and aggregation coordination.
 * Handles all source-related operations including finding the fusion source,
 * managing managed sources, and coordinating aggregations.
 */
export class SourceService {
    // Unified source storage - both managed and fusion sources
    private sourcesById: Map<string, SourceInfo> = new Map()
    private sourcesByName: Map<string, SourceInfo> = new Map()
    private fusionLatestAggregationDate: Date | undefined
    private _allSources?: SourceInfo[]
    private _fusionSourceId?: string
    private _fusionSourceOwner?: OwnerDto

    // Account caching
    public managedAccountsById: Map<string, Account> = new Map()
    public fusionAccountsByNativeIdentity?: Map<string, Account>

    // Config settings
    private readonly sources: SourceConfig[]
    private readonly spConnectorInstanceId: string
    private readonly taskResultRetries: number
    private readonly taskResultWait: number

    // ------------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------------

    constructor(
        config: FusionConfig,
        private log: LogService,
        private client: ClientService
    ) {
        this.sources = config.sources
        this.spConnectorInstanceId = config.spConnectorInstanceId
        this.taskResultRetries = config.taskResultRetries
        this.taskResultWait = config.taskResultWait
    }

    // ------------------------------------------------------------------------
    // Public Properties/Getters
    // ------------------------------------------------------------------------

    /**
     * Get fusion source ID
     */
    public get fusionSourceId(): string {
        assert(this._fusionSourceId, 'Fusion source not found')
        return this._fusionSourceId
    }

    /**
     * Get all managed sources
     */
    public get managedSources(): SourceInfo[] {
        assert(this._allSources, 'Sources have not been loaded')
        return this._allSources.filter((s) => s.id !== this.fusionSourceId)
    }

    /**
     * Get all sources (managed + fusion)
     */
    public get allSources(): SourceInfo[] {
        assert(this._allSources, 'Sources have not been loaded')
        return this._allSources
    }

    /**
     * Get all managed accounts
     */
    public get managedAccounts(): Account[] {
        assert(this.managedAccountsById, 'Managed accounts have not been loaded')
        return Array.from(this.managedAccountsById.values())
    }

    /**
     * Get all fusion accounts
     */
    public get fusionAccounts(): Account[] {
        assert(this.fusionAccountsByNativeIdentity, 'Fusion accounts have not been loaded')
        return Array.from(this.fusionAccountsByNativeIdentity.values())
    }

    // ------------------------------------------------------------------------
    // Public Source Fetch Methods
    // ------------------------------------------------------------------------

    /**
     * Fetch all sources (managed and fusion) and cache them
     */
    public async fetchAllSources(): Promise<void> {
        this.log.debug('Fetching all sources')
        const { sourcesApi } = this.client

        const listSources = async (requestParameters?: SourcesV2025ApiListSourcesRequest) => {
            return await sourcesApi.listSources(requestParameters)
        }
        const apiSources = await this.client.paginate(listSources)
        assert(apiSources.length > 0, 'Sources not found')

        // Build unified source info from SourceConfig + API IDs
        const resolvedSources: SourceInfo[] = []

        // Add managed sources (from config.sources)
        for (const sourceConfig of this.sources) {
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
            (x) => (x.connectorAttributes as BaseConfig).spConnectorInstanceId === this.spConnectorInstanceId
        )
        assert(fusionSource, 'Fusion source not found')
        assert(fusionSource.owner, 'Fusion source owner not found')
        this._fusionSourceId = fusionSource.id!
        this._fusionSourceOwner = {
            id: fusionSource.owner.id!,
            type: 'IDENTITY',
        }

        resolvedSources.push({
            id: fusionSource.id!,
            name: fusionSource.name!,
            isManaged: false,
            config: undefined, // Fusion source has no SourceConfig
            owner: this._fusionSourceOwner,
        })

        this._allSources = resolvedSources
        this.sourcesById = new Map(resolvedSources.map((x) => [x.id, x]))
        this.sourcesByName = new Map(resolvedSources.map((x) => [x.name, x]))

        const managedCount = resolvedSources.filter((s) => s.isManaged).length
        this.log.debug(`Fetched ${managedCount} managed source(s) and fusion source: ${fusionSource.name}`)
    }

    // ------------------------------------------------------------------------
    // Public Source Lookup Methods
    // ------------------------------------------------------------------------

    /**
     * Get fusion source info
     */
    public getFusionSource(): SourceInfo | undefined {
        return Array.from(this.sourcesById.values()).find((s) => !s.isManaged)
    }

    /**
     * Get fusion source owner
     */
    public get fusionSourceOwner(): OwnerDto {
        assert(this._fusionSourceOwner, 'Fusion source owner not found')
        return this._fusionSourceOwner
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

    // ------------------------------------------------------------------------
    // Public Source Configuration Methods
    // ------------------------------------------------------------------------

    /**
     * Get source configuration by source name (only for managed sources)
     */
    public getSourceConfig(sourceName: string): SourceConfig | undefined {
        const sourceInfo = this.sourcesByName.get(sourceName)
        return sourceInfo?.config ?? this.sources.find((sc) => sc.name === sourceName)
    }

    /**
     * Get account filter for a source
     */
    public getAccountFilter(sourceName: string): string | undefined {
        return this.getSourceConfig(sourceName)?.accountFilter
    }

    // ------------------------------------------------------------------------
    // Public Account Fetch Methods (Bulk)
    // ------------------------------------------------------------------------

    /**
     * Fetch all accounts for a given source ID, applying SourceConfig.accountFilter if present (for managed sources).
     */
    public async fetchSourceAccountsById(sourceId: string, limit?: number): Promise<Account[]> {
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
            limit,
        }

        const listAccounts = async (params: AccountsApiListAccountsRequest) => {
            return await accountsApi.listAccounts(params)
        }
        return await this.client.paginate(listAccounts, requestParameters)
    }

    /**
     * Fetch and cache fusion accounts
     */
    public async fetchFusionAccounts(): Promise<void> {
        this.log.debug('Fetching fusion accounts')
        const accounts = await this.fetchSourceAccountsById(this.fusionSourceId)
        this.fusionAccountsByNativeIdentity = new Map(accounts.map((account) => [account.nativeIdentity!, account]))
        this.log.debug(`Fetched ${this.fusionAccountsByNativeIdentity.size} fusion account(s)`)
    }

    /**
     * Fetch and cache managed accounts from all managed sources
     */
    public async fetchManagedAccounts(): Promise<void> {
        this.log.debug(`Fetching managed accounts from ${this.managedSources.length} source(s)`)
        const accounts = (
            await Promise.all(
                this.managedSources.map((s) => this.fetchSourceAccountsById(s.id, s.config?.accountLimit))
            )
        ).flat()
        this.managedAccountsById = new Map(accounts.map((account) => [account.id!, account]))
        this.log.debug(`Fetched ${this.managedAccountsById.size} managed account(s)`)
    }

    // ------------------------------------------------------------------------
    // Public Account Fetch Methods (Single)
    // ------------------------------------------------------------------------

    /**
     * Fetch and cache a single fusion account by nativeIdentity
     */
    public async fetchFusionAccount(nativeIdentity: string): Promise<void> {
        this.log.debug('Fetching fusion account')
        const fusionAccount = await this.fetchSourceAccountByNativeIdentity(this.fusionSourceId, nativeIdentity)
        assert(fusionAccount, 'Fusion account not found')

        if (!this.fusionAccountsByNativeIdentity) {
            this.fusionAccountsByNativeIdentity = new Map()
        }
        this.fusionAccountsByNativeIdentity.set(fusionAccount.nativeIdentity!, fusionAccount)
        this.log.debug(`Fetched fusion account: ${fusionAccount.name}`)
    }

    /**
     * Fetch and cache a single managed account by ID
     */
    public async fetchManagedAccount(id: string): Promise<void> {
        const managedAccount = await this.fetchAccountById(id)
        assert(managedAccount, 'Managed account not found')

        this.managedAccountsById.set(managedAccount.id!, managedAccount)
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
            const response = await accountsApi.listAccounts(requestParameters)
            return response.data ?? []
        }

        const accounts = await this.client.execute(listAccounts)
        return accounts[0]
    }

    // ------------------------------------------------------------------------
    // Public Aggregation Methods
    // ------------------------------------------------------------------------

    /**
     * Aggregate a source
     */
    public async aggregateSourceAccounts(sourceId: string): Promise<void> {
        await this.aggregateAccounts(sourceId)
    }

    /**
     * Aggregate all managed sources that need aggregation
     */
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
        const aggregations = await this.client.execute(searchPost)

        const latestAggregation = getDateFromISOString(aggregations[0]?.created)

        return latestAggregation
    }

    // ------------------------------------------------------------------------
    // Public Schema Methods
    // ------------------------------------------------------------------------

    /**
     * List schemas for a source
     */
    public async listSourceSchemas(sourceId: string): Promise<SchemaV2025[]> {
        const { sourcesApi } = this.client
        const requestParameters: SourcesV2025ApiGetSourceSchemasRequest = {
            sourceId,
        }
        const getSourceSchemas = async () => {
            const response = await sourcesApi.getSourceSchemas(requestParameters)
            return response.data ?? []
        }
        const schemas = await this.client.execute(getSourceSchemas)
        return schemas
    }

    // ------------------------------------------------------------------------
    // Public Configuration Methods
    // ------------------------------------------------------------------------

    /**
     * Update source configuration
     */
    public async patchSourceConfig(id: string, requestParameters: SourcesV2025ApiUpdateSourceRequest): Promise<Source> {
        const { sourcesApi } = this.client
        const updateSource = async () => {
            const response = await sourcesApi.updateSource(requestParameters)
            return response.data
        }
        return await this.client.execute(updateSource)
    }

    // ------------------------------------------------------------------------
    // Private Helper Methods
    // ------------------------------------------------------------------------

    /**
     * Fetch a single account by ID
     */
    private async fetchAccountById(id: string): Promise<Account | undefined> {
        const { accountsApi } = this.client
        const requestParameters: AccountsApiGetAccountRequest = {
            id,
        }
        const getAccount = async () => {
            const response = await accountsApi.getAccount(requestParameters)
            return response.data ?? undefined
        }
        const account = await this.client.execute(getAccount)
        return account
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
     * Aggregate accounts for a source
     */
    private async aggregateAccounts(id: string): Promise<void> {
        let completed = false
        const { sourcesApi, taskManagementApi } = this.client
        const requestParameters: SourcesV2025ApiImportAccountsRequest = {
            id,
        }
        const importAccounts = async () => {
            const response = await sourcesApi.importAccounts(requestParameters)
            return response.data
        }
        const loadAccountsTask = await this.client.execute(importAccounts)

        // Use global retry settings for aggregation task polling
        const taskResultRetries = this.taskResultRetries
        const taskResultWait = this.taskResultWait

        let count = taskResultRetries
        while (--count > 0) {
            const requestParameters: TaskManagementV2025ApiGetTaskStatusRequest = {
                id: loadAccountsTask.task?.id ?? '',
            }
            const getTaskStatus = async () => {
                const response = await taskManagementApi.getTaskStatus(requestParameters)
                return response.data
            }
            const taskStatus = await this.client.execute(getTaskStatus)

            if (taskStatus.completed) {
                completed = true
                break
            } else {
                await new Promise((resolve) => setTimeout(resolve, taskResultWait))
            }
        }
        softAssert(completed, 'Failed to aggregate managed accounts')
    }
}
