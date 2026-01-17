import { AccountsApiUpdateAccountRequest, IdentityDocument, Search } from 'sailpoint-api-client'
import { FusionConfig } from '../model/config'
import { ClientService } from './clientService'
import { LogService } from './logService'
import { assert } from '../utils/assert'
import { FusionAccount } from '../model/account'

// ============================================================================
// IdentityService Class
// ============================================================================

/**
 * Service for managing identity documents, identity lookups, and reviewer management.
 */
export class IdentityService {
    private identitiesById: Map<string, IdentityDocument> = new Map()
    private readonly identityScopeQuery?: string
    private readonly includeIdentities: boolean

    // ------------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------------

    constructor(
        config: FusionConfig,
        private log: LogService,
        private client: ClientService
    ) {
        this.identityScopeQuery = config.identityScopeQuery
        this.includeIdentities = config.includeIdentities ?? true
    }

    // ------------------------------------------------------------------------
    // Public Properties/Getters
    // ------------------------------------------------------------------------

    /**
     * Get all identities
     */
    public get identities(): IdentityDocument[] {
        assert(this.identitiesById, 'Identities not fetched')
        return Array.from(this.identitiesById.values())
    }

    // ------------------------------------------------------------------------
    // Public Fetch Methods
    // ------------------------------------------------------------------------

    /**
     * Fetch identities and cache them
     */
    public async fetchIdentities(): Promise<void> {
        if (!this.includeIdentities) {
            this.log.info('Identity fetching disabled by configuration, skipping identity fetch.')
            return
        }

        if (this.identityScopeQuery) {
            this.log.info('Fetching identities.')

            //TODO: only fetch relevant attributes

            const query: Search = {
                indices: ['identities'],
                query: {
                    query: this.identityScopeQuery,
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

    /**
     * Fetch a single identity by ID and cache it
     */
    public async fetchIdentityById(id: string): Promise<IdentityDocument> {
        this.log.info(`Fetching identity ${id}.`)

        //TODO: only fetch relevant attributes

        const query: Search = {
            indices: ['identities'],
            query: {
                query: `id:"${id}"`,
            },
            includeNested: true,
        }

        const identities = await this.client.paginateSearchApi<IdentityDocument>(query)
        identities.forEach((identity) => this.identitiesById.set(identity.id, identity))

        return identities[0]
    }

    /**
     * Fetch a single identity by ID and cache it
     */
    public async fetchIdentityByName(name: string): Promise<IdentityDocument> {
        this.log.info(`Fetching identity ${name}.`)

        //TODO: only fetch relevant attributes

        const query: Search = {
            indices: ['identities'],
            query: {
                query: `name.exact:"${name}"`,
            },
            includeNested: true,
        }

        const identities = await this.client.paginateSearchApi<IdentityDocument>(query)
        identities.forEach((identity) => this.identitiesById.set(identity.id, identity))

        return identities[0]
    }

    // ------------------------------------------------------------------------
    // Public Lookup Methods
    // ------------------------------------------------------------------------

    /**
     * Get identity by ID from cache
     */
    public getIdentityById(id?: string): IdentityDocument | undefined {
        if (id) {
            return this.identitiesById.get(id)
        }
    }

    // ------------------------------------------------------------------------
    // Public Correlation Methods
    // ------------------------------------------------------------------------

    /**
     * Correlate an account to an identity
     */
    public async correlateAccounts(fusionAccount: FusionAccount): Promise<boolean> {
        const { missingAccountIds, identityId } = fusionAccount
        const { accountsApi } = this.client

        missingAccountIds.forEach((accountId) => {
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

            // Fire-and-track only: correlation outcome shouldn't affect current run state
            const response = this.client.execute(updateAccount)
            fusionAccount.addCorrelationPromise(accountId, response)
        })

        return true
    }

    // ------------------------------------------------------------------------
    // Public Utility Methods
    // ------------------------------------------------------------------------

    /**
     * Clear the identity cache
     */
    public clear(): void {
        this.identitiesById.clear()
    }
}
