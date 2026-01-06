import {
    Search,
    Source,
    SourceOwner,
    Schema,
    SourcesApiGetSourceSchemasRequest,
    SourcesApiListSourcesRequest,
    SearchApiSearchPostRequest,
    SourcesV2025ApiImportAccountsRequest,
    TaskManagementV2025ApiGetTaskStatusRequest,
} from 'sailpoint-api-client'
import { BaseConfig, FusionConfig } from '../model/config'
import { ClientService } from './clientService'
import { LogService } from './logService'
import { assert, softAssert } from '../utils/assert'
import { getDateFromISOString } from '../utils/date'

/**
 * Service for managing sources, source discovery, and aggregation coordination.
 * Handles all source-related operations including finding the fusion source,
 * managing managed sources, and coordinating aggregations.
 */
export class SourceService {
    private sourcesById: Map<string, Source> = new Map()
    private sourcesByName: Map<string, Source> = new Map()
    private _managedSources?: Source[]
    private _fusionSourceId: string | undefined
    private fusionLatestAggregationDate: Date | undefined

    constructor(
        private config: FusionConfig,
        private log: LogService,
        private client: ClientService
    ) {}

    public get fusionSource(): Source {
        assert(this._fusionSourceId !== undefined, 'Fusion source ID is undefined')
        return this.sourcesById.get(this._fusionSourceId!)!
    }

    public get fusionSourceId(): string {
        return this.fusionSource.id!
    }

    public get managedSources(): Source[] {
        assert(this._managedSources, 'Sources have not been loaded')
        return this._managedSources
    }

    public async fetchAllSources(): Promise<void> {
        this.log.debug('Fetching all sources')
        const { sourcesApi } = this.client
        const requestParameters: SourcesApiListSourcesRequest = {}

        const listSources = async (params: SourcesApiListSourcesRequest) => {
            return await sourcesApi.listSources(params)
        }
        const allSources = await this.client.paginate(listSources, requestParameters)
        assert(allSources.length > 0, 'Sources not found')

        const sources = allSources.filter((x) => this.config.sources.includes(x.name))
        this.sourcesById = new Map(sources.map((x) => [x.id!, x]))
        this.sourcesByName = new Map(sources.map((x) => [x.name, x]))
        this._managedSources = sources

        const missingSources = this.config.sources.filter((name) => !sources.find((s) => s.name === name))
        assert(missingSources.length === 0, `Unable to find sources: ${missingSources.join(', ')}`)

        // Find and initialize fusion source
        const fusionSource = allSources.find(
            (x) => (x.connectorAttributes as BaseConfig).spConnectorInstanceId === this.config.spConnectorInstanceId
        )

        assert(fusionSource, 'Fusion source not found')
        assert(fusionSource.owner, 'Fusion source owner not found')

        this._fusionSourceId = fusionSource.id!
        this.sourcesById.set(fusionSource.id!, fusionSource)
        this.sourcesByName.set(fusionSource.name!, fusionSource)
        this.log.debug(`Fetched ${sources.length} managed source(s) and fusion source: ${fusionSource.name}`)
    }

    public getFusionSource(): Source | undefined {
        return this.sourcesById.get(this._fusionSourceId!)
    }

    /**
     * Get a source by name
     */
    public getSourceByName(name: string): Source | undefined {
        return this.sourcesByName.get(name)
    }

    /**
     * Get source by ID
     */
    public getSourceById(id: string): Source | undefined {
        return this.sourcesById.get(id)
    }

    /**
     * Get the source owner
     */
    public getSourceOwner(source: Source): SourceOwner {
        return source.owner!
    }

    /**
     * Get latest aggregation date for a source
     */

    public async getLatestAggregationDate(sourceId: string): Promise<Date> {
        const source = this.getSourceById(sourceId)
        assert(source, 'Source not found')
        const sourceName = source.name!

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
     * Check if a source should be aggregated based on fusion aggregation date
     */
    private async shouldAggregateSource(source: Source): Promise<boolean> {
        if (!this.fusionLatestAggregationDate) {
            this.fusionLatestAggregationDate = await this.getLatestAggregationDate(this.fusionSourceId)
        }

        const latestSourceDate = await this.getLatestAggregationDate(source.id!)
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

        let count = this.config.taskResultRetries
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
                await new Promise((resolve) => setTimeout(resolve, this.config.taskResultWait))
            }
        }
        softAssert(completed, 'Failed to aggregate managed accounts')
    }

    public async listSourceSchemas(sourceId: string): Promise<Schema[]> {
        const { sourcesApi } = this.client
        const requestParameters: SourcesApiGetSourceSchemasRequest = {
            sourceId,
        }
        const request = async () => {
            const response = await sourcesApi.getSourceSchemas(requestParameters)
            return response.data ?? []
        }
        const response = await this.client.execute(request)
        return response
    }

    public async aggregateManagedSources(): Promise<void> {
        if (!this.config.forceAggregation) {
            this.log.debug('Force aggregation is disabled, skipping source aggregation')
            return
        }

        this.log.debug(`Checking aggregation status for ${this.managedSources.length} managed source(s)`)
        const aggregationPromises = []
        for (const source of this.managedSources) {
            const shouldAggregate = await this.shouldAggregateSource(source)
            if (shouldAggregate) {
                this.log.info(`Aggregating source: ${source.name}`)
                aggregationPromises.push(this.aggregateSourceAccounts(source.id!))
            } else {
                this.log.debug(`Source ${source.name} does not need aggregation`)
            }
        }

        await Promise.all(aggregationPromises)
        this.log.debug('Source aggregation completed')
    }
}
