import { AccountsApi, AccountsApiUpdateAccountRequest, IdentityDocument, Search } from 'sailpoint-api-client'
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
            this.identitiesById = new Map(
                identities.map((identity) => [identity.protected ? '-' : identity.id, identity])
            )
            this.identitiesById.delete('-')
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

    public async correlateAccount(accountId: string, identityId: string): Promise<boolean> {
        const { accountsApi } = this.client

        const requestParameters: AccountsApiUpdateAccountRequest = {
            id: accountId,
            requestBody: [
                {
                    op: 'replace',
                    path: '/identityId',
                    value: identityId,
                },
            ],
        }

        const updateAccount = async () => {
            return await accountsApi.updateAccount(requestParameters)
        }

        const response = await this.client.execute(updateAccount)

        //TODO: handle response
        return true
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
