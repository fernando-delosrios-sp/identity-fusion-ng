import { IdentityDocument, Search } from 'sailpoint-api-client'
import { FusionConfig } from '../model/config'
import { ClientService } from './clientService'
import { LogService } from './logService'
import { assert } from '../utils/assert'

/**
 * Service for managing identity documents, identity lookups, and reviewer management.
 */
export class IdentityService {
    private identitiesById: Map<string, IdentityDocument> = new Map()

    constructor(
        private config: FusionConfig,
        private log: LogService,
        private client: ClientService
    ) {}

    public get identities(): IdentityDocument[] {
        assert(this.identitiesById, 'Identities not fetched')
        return Array.from(this.identitiesById.values())
    }

    /**
     * Fetch identities and cache them
     */
    public async fetchIdentities(): Promise<void> {
        if (this.config.identityScopeQuery) {
            this.log.info('Fetching identities.')

            //TODO: only fetch relevant attributes

            const query: Search = {
                indices: ['identities'],
                query: {
                    query: this.config.identityScopeQuery,
                },
                includeNested: true,
            }

            const identities = await this.client.paginateSearchApi<IdentityDocument>(query)
            this.identitiesById = new Map(identities.map((identity) => [identity.id, identity]))
        } else {
            this.log.info('No identity scope query defined, skipping identity fetch.')
            this.identitiesById = new Map()
        }
    }

    public async fetchIdentityById(id: string): Promise<void> {
        this.log.info(`Fetching identity ${id}.`)

        //TODO: only fetch relevant attributes

        const query: Search = {
            indices: ['identities'],
            query: {
                query: `id:${id}`,
            },
            includeNested: true,
        }

        const identities = await this.client.paginateSearchApi<IdentityDocument>(query)
        this.identitiesById = new Map(identities.map((identity) => [identity.id, identity]))
    }

    public getIdentityById(id?: string): IdentityDocument | undefined {
        if (id) {
            return this.identitiesById.get(id)
        }
    }

    public clear(): void {
        this.identitiesById.clear()
    }
}
