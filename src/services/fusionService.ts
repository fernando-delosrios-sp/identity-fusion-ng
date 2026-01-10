import { Account, IdentityDocument, SourcesApiUpdateSourceRequest } from 'sailpoint-api-client'
import { StdAccountListOutput } from '@sailpoint/connector-sdk'
import { FusionConfig } from '../model/config'
import { LogService } from './logService'
import { FormService } from './formService'
import { IdentityService } from './identityService'
import { SourceService } from './sourceService'
import { FusionAccount } from '../model/account'
import { attrConcat, AttributeService } from './attributeService'
import { assert } from '../utils/assert'
import { FusionDecision } from '../model/form'
import { ScoringService } from './scoringService'
import { SchemaService } from './schemaService'

/**
 * Service for identity merging/deduplication logic.
 * Pure in-memory operations - no ClientService dependency.
 * All data structures are passed in as parameters.
 */
export class FusionService {
    private _fusionIdentityMap: Map<string, FusionAccount> = new Map()
    private _fusionAccounts: FusionAccount[] = []
    private _reviewersBySource: Map<string, Set<FusionAccount>> = new Map()

    constructor(
        private config: FusionConfig,
        private log: LogService,
        private identities: IdentityService,
        private sources: SourceService,
        private forms: FormService,
        private attributes: AttributeService,
        private scoring: ScoringService,
        private schemas: SchemaService
    ) {
        // TODO: Use assertion + getter instead
        this.config.sources.forEach((sourceConfig) => {
            this._reviewersBySource.set(sourceConfig.name, new Set())
        })
    }

    public isReset(): boolean {
        return this.config.reset
    }

    public async disableReset(): Promise<void> {
        const fusionSourceId = this.sources.fusionSourceId
        const requestParameters: SourcesApiUpdateSourceRequest = {
            id: fusionSourceId,
            jsonPatchOperation: [
                {
                    op: 'replace',
                    path: '/connectorAttributes/reset',
                    value: false,
                },
            ],
        }
        await this.sources.patchSourceConfig(fusionSourceId, requestParameters)
    }

    public async processFusionAccounts(): Promise<void> {
        const { fusionAccounts } = this.sources
        await Promise.all(fusionAccounts.map((x: Account) => this.processFusionAccount(x)))
    }

    public async processFusionAccount(account: Account): Promise<FusionAccount> {
        assert(
            !this._fusionIdentityMap.has(account.nativeIdentity),
            `Fusion account found for ${account.nativeIdentity}. Should not process Fusion accounts more than once.`
        )
        const managedAccountsMap = this.sources.managedAccountsById
        const identityId = account.identityId!

        const fusionAccount = FusionAccount.fromFusionAccount(this.config, account)
        fusionAccount.reviewerForSources().forEach((source) => {
            this._reviewersBySource.get(source)?.add(fusionAccount)
        })

        const identity = this.identities.getIdentityById(identityId)
        if (identity) {
            fusionAccount.addIdentityLayer(identity)

            const fusionDecision = this.forms.getAssignmentFusionDecision(identity.attributes?.uid)
            fusionAccount.addFusionDecisionLayer(fusionDecision)
        }

        // Pass the captured map reference directly
        fusionAccount.addManagedAccountLayer(managedAccountsMap)

        if (identity) {
            const editDecision = this.forms.getEditDecision(identity.attributes?.uid)
            fusionAccount.addEditDecisionLayer(editDecision)
        }

        await this.attributes.registerUniqueAttributes(fusionAccount)
        if (fusionAccount.needsRefresh) {
            this.attributes.mapAttributes(fusionAccount)
            await this.attributes.refreshAttributes(fusionAccount)
        }

        if (account.uncorrelated) {
            this._fusionAccounts.push(fusionAccount)
        } else {
            if (this.config.correlateOnAggregation) {
                // TODO: rearrange
                await fusionAccount.correlateMissingAccounts(this.identities.correlateAccount.bind(this.identities))
            }
            this._fusionIdentityMap.set(identityId, fusionAccount)
        }

        return fusionAccount
    }

    public async processIdentities(): Promise<void> {
        const { identities } = this.identities
        this.log.debug(`Processing ${identities.length} identities`)
        await Promise.all(identities.map((x) => this.processIdentity(x)))
        this.log.debug('Identities processing completed')
    }

    public async processIdentity(identity: IdentityDocument): Promise<void> {
        const { fusionDisplayAttribute } = this.schemas
        const identityId = identity.id

        if (!this._fusionIdentityMap.has(identityId)) {
            const fusionAccount = FusionAccount.fromIdentity(this.config, identity)
            fusionAccount.addIdentityLayer(identity)

            fusionAccount.addManagedAccountLayer(this.sources.managedAccountsById)

            this.attributes.mapAttributes(fusionAccount)
            await this.attributes.refreshAttributes(fusionAccount)
            fusionAccount.attributes[fusionDisplayAttribute] = identity.name

            this._fusionIdentityMap.set(identityId, fusionAccount)
        }
    }

    public async processIdentityFusionDecisions(): Promise<void> {
        const identityFusionDecisions = this.forms.getIdentityFusionDecisions()
        this.log.debug(`Processing ${identityFusionDecisions.length} identity fusion decision(s)`)
        await Promise.all(identityFusionDecisions.map((x) => this.processIdentityFusionDecision(x)))
        this.log.debug('Identity fusion decisions processing completed')
    }

    public async processIdentityFusionDecision(fusionDecision: FusionDecision): Promise<void> {
        const fusionAccount = FusionAccount.fromFusionDecision(this.config, fusionDecision)
        fusionAccount.addFusionDecisionLayer(fusionDecision)

        const { managedAccountsById } = this.sources
        fusionAccount.addManagedAccountLayer(managedAccountsById)

        this.attributes.mapAttributes(fusionAccount)
        await this.attributes.refreshAttributes(fusionAccount)

        this._fusionAccounts.push(fusionAccount)
    }

    public async processManagedAccounts(): Promise<void> {
        const { managedAccountsById } = this.sources
        const managedAccounts = Array.from(managedAccountsById.values()) as Account[]

        this.log.debug(`Processing ${managedAccounts.length} managed account(s)`)
        await Promise.all(managedAccounts.map((x: Account) => this.processManagedAccount(x)))
        this.log.debug('Managed accounts processing completed')
    }

    public async analyzeManagedAccounts(): Promise<void> {
        const { managedAccountsById } = this.sources
        const managedAccounts = Array.from(managedAccountsById.values()) as Account[]

        await Promise.all(managedAccounts.map((x: Account) => this.analyzeManagedAccount(x)))
    }

    private async preProcessManagedAccount(account: Account): Promise<FusionAccount> {
        const fusionAccount = FusionAccount.fromManagedAccount(this.config, account)
        const fusionIdentities = Array.from(this._fusionAccounts.values())

        fusionAccount.addManagedAccountLayer(this.sources.managedAccountsById)

        this.attributes.mapAttributes(fusionAccount)
        await this.attributes.refreshNonUniqueAttributes(fusionAccount)

        await this.scoring.analyzeFusionAccount(fusionAccount, fusionIdentities)

        return fusionAccount
    }

    public async processManagedAccount(account: Account): Promise<void> {
        const fusionAccount = await this.preProcessManagedAccount(account)

        if (fusionAccount.duplicate) {
            this.log.debug(`Account ${account.name} is a duplicate, creating fusion form`)
            const reviewers = this._reviewersBySource.get(fusionAccount.sourceName)
            this.forms.createFusionForm(fusionAccount, reviewers)
        } else {
            this.log.debug(`Account ${account.name} is not a duplicate, adding to fusion accounts`)
            await this.attributes.refreshUniqueAttributes(fusionAccount)
            this._fusionAccounts.push(fusionAccount)
        }
    }

    public async analyzeManagedAccount(account: Account): Promise<void> {
        const fusionAccount = await this.preProcessManagedAccount(account)

        this._fusionAccounts.push(fusionAccount)
    }

    private getISCAccount(fusionAccount: FusionAccount): StdAccountListOutput {
        const attributes = this.schemas.getFusionAttributeSubset(fusionAccount.attributes)
        const disabled = fusionAccount.disabled
        const key = this.attributes.getSimpleKey(fusionAccount)
        attributes.sources = attrConcat(Array.from(fusionAccount.sources))
        attributes.accounts = Array.from(fusionAccount.accountIds)
        attributes.history = fusionAccount.history
        attributes['missing-accounts'] = Array.from(fusionAccount.missingAccountIds)
        attributes.reviews = Array.from(fusionAccount.reviews)
        attributes.statuses = Array.from(fusionAccount.statuses)
        attributes.actions = Array.from(fusionAccount.actions)

        return {
            key,
            attributes,
            disabled,
        }
    }

    public async listISCAccounts(): Promise<StdAccountListOutput[]> {
        return [
            ...this._fusionAccounts.map((x) => this.getISCAccount(x)),
            ...Array.from(this._fusionIdentityMap.values()).map((x) => this.getISCAccount(x)),
        ]
    }
}

// export const createKey = (id: string): SimpleKeyType => {
//     return {
//         simple: {
//             id,
//         },
//     }
// }
