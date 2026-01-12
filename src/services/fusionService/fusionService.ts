import { Account, IdentityDocument, SourcesApiUpdateSourceRequest } from 'sailpoint-api-client'
import { StdAccountListOutput } from '@sailpoint/connector-sdk'
import { FusionConfig, SourceConfig } from '../../model/config'
import { LogService } from '../logService'
import { FormService } from '../formService'
import { IdentityService } from '../identityService'
import { SourceService } from '../sourceService'
import { FusionAccount } from '../../model/account'
import { attrConcat, AttributeService } from '../attributeService'
import { assert } from '../../utils/assert'
import { FusionDecision } from '../../model/form'
import { ScoringService } from '../scoringService'
import { SchemaService } from '../schemaService'
import { FusionReport, FusionReportAccount } from './types'

// ============================================================================
// FusionService Class
// ============================================================================

/**
 * Service for identity merging/deduplication logic.
 * Pure in-memory operations - no ClientService dependency.
 * All data structures are passed in as parameters.
 */
export class FusionService {
    generateReport(): FusionReport {
        const accounts: FusionReportAccount[] = []

        // Process all fusion accounts that have matches
        for (const fusionAccount of this._fusionAccounts) {
            if (fusionAccount.fusionMatches && fusionAccount.fusionMatches.length > 0) {
                const matches = fusionAccount.fusionMatches.map((match) => ({
                    identityName: match.fusionIdentity.name || match.fusionIdentity.displayName || 'Unknown',
                    identityId: match.fusionIdentity.identityId,
                    isMatch: true,
                    scores: match.scores.map((score) => ({
                        attribute: score.attribute,
                        algorithm: score.algorithm,
                        score: score.score,
                        fusionScore: score.fusionScore,
                        isMatch: score.isMatch,
                        comment: score.comment,
                    })),
                }))

                accounts.push({
                    accountName: fusionAccount.name || fusionAccount.displayName || 'Unknown',
                    accountSource: fusionAccount.sourceName,
                    accountEmail: fusionAccount.email,
                    accountAttributes: fusionAccount.attributes,
                    matches,
                })
            }
        }

        const potentialDuplicates = accounts.filter((a) => a.matches.length > 0).length

        return {
            accounts,
            totalAccounts: this._fusionAccounts.length,
            potentialDuplicates,
            reportDate: new Date(),
        }
    }
    private _fusionIdentityMap: Map<string, FusionAccount> = new Map()
    private _fusionAccounts: FusionAccount[] = []
    private _reviewersBySource: Map<string, Set<FusionAccount>> = new Map()
    private readonly sourceConfigs: SourceConfig[]
    private readonly reset: boolean
    private readonly correlateOnAggregation: boolean
    private readonly spConnectorInstanceId: string

    // ------------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------------

    constructor(
        private config: FusionConfig,
        private log: LogService,
        private identities: IdentityService,
        private sourceService: SourceService,
        private forms: FormService,
        private attributes: AttributeService,
        private scoring: ScoringService,
        private schemas: SchemaService
    ) {
        this.sourceConfigs = config.sources
        this.reset = config.reset
        this.correlateOnAggregation = config.correlateOnAggregation
        this.spConnectorInstanceId = config.spConnectorInstanceId
        // TODO: Use assertion + getter instead
        this.sourceConfigs.forEach((sourceConfig) => {
            this._reviewersBySource.set(sourceConfig.name, new Set())
        })
    }

    // ------------------------------------------------------------------------
    // Public Reset/Configuration Methods
    // ------------------------------------------------------------------------

    /**
     * Check if reset is enabled
     */
    public isReset(): boolean {
        return this.reset
    }

    /**
     * Disable the reset flag in the source configuration
     */
    public async disableReset(): Promise<void> {
        const fusionSourceId = this.sourceService.fusionSourceId
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
        await this.sourceService.patchSourceConfig(fusionSourceId, requestParameters)
    }

    // ------------------------------------------------------------------------
    // Public Fusion Account Processing Methods
    // ------------------------------------------------------------------------

    /**
     * Process all fusion accounts from sources
     */
    public async processFusionAccounts(): Promise<void> {
        const fusionAccounts = this.sourceService.fusionAccounts
        await Promise.all(fusionAccounts.map((x: Account) => this.processFusionAccount(x)))
    }

    /**
     * Process a single fusion account
     */
    public async processFusionAccount(account: Account): Promise<FusionAccount> {
        assert(
            !this._fusionIdentityMap.has(account.nativeIdentity),
            `Fusion account found for ${account.nativeIdentity}. Should not process Fusion accounts more than once.`
        )
        const managedAccountsMap = this.sourceService.managedAccountsById
        assert(managedAccountsMap, 'Managed accounts have not been loaded')
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
            if (this.correlateOnAggregation) {
                const { correlateAccount } = this.identities
                await fusionAccount.correlateMissingAccounts(correlateAccount.bind(this.identities))
            }
            this._fusionIdentityMap.set(identityId, fusionAccount)
        }

        return fusionAccount
    }

    // ------------------------------------------------------------------------
    // Public Identity Processing Methods
    // ------------------------------------------------------------------------

    /**
     * Process all identities
     */
    public async processIdentities(): Promise<void> {
        const { identities } = this.identities
        this.log.debug(`Processing ${identities.length} identities`)
        await Promise.all(identities.map((x) => this.processIdentity(x)))
        this.log.debug('Identities processing completed')
    }

    /**
     * Process a single identity
     */
    public async processIdentity(identity: IdentityDocument): Promise<void> {
        const { fusionDisplayAttribute } = this.schemas
        const identityId = identity.id

        if (!this._fusionIdentityMap.has(identityId)) {
            const fusionAccount = FusionAccount.fromIdentity(this.config, identity)
            fusionAccount.addIdentityLayer(identity)

            const managedAccountsMap = this.sourceService.managedAccountsById
            assert(managedAccountsMap, 'Managed accounts have not been loaded')
            fusionAccount.addManagedAccountLayer(managedAccountsMap)

            this.attributes.mapAttributes(fusionAccount)
            await this.attributes.refreshAttributes(fusionAccount)
            fusionAccount.attributes[fusionDisplayAttribute] = identity.name

            this._fusionIdentityMap.set(identityId, fusionAccount)
        }
    }

    /**
     * Process all identity fusion decisions
     */
    public async processIdentityFusionDecisions(): Promise<void> {
        const identityFusionDecisions = this.forms.getIdentityFusionDecisions()
        this.log.debug(`Processing ${identityFusionDecisions.length} identity fusion decision(s)`)
        await Promise.all(identityFusionDecisions.map((x) => this.processIdentityFusionDecision(x)))
        this.log.debug('Identity fusion decisions processing completed')
    }

    /**
     * Process a single identity fusion decision
     */
    public async processIdentityFusionDecision(fusionDecision: FusionDecision): Promise<void> {
        const fusionAccount = FusionAccount.fromFusionDecision(this.config, fusionDecision)
        fusionAccount.addFusionDecisionLayer(fusionDecision)

        const managedAccountsMap = this.sourceService.managedAccountsById
        assert(managedAccountsMap, 'Managed accounts have not been loaded')
        fusionAccount.addManagedAccountLayer(managedAccountsMap)

        this.attributes.mapAttributes(fusionAccount)
        await this.attributes.refreshAttributes(fusionAccount)

        this._fusionAccounts.push(fusionAccount)
    }

    // ------------------------------------------------------------------------
    // Public Managed Account Processing Methods
    // ------------------------------------------------------------------------

    /**
     * Process all managed accounts
     */
    public async processManagedAccounts(): Promise<void> {
        const managedAccounts = this.sourceService.managedAccounts

        this.log.debug(`Processing ${managedAccounts.length} managed account(s)`)
        await Promise.all(managedAccounts.map((x: Account) => this.processManagedAccount(x)))
        this.log.debug('Managed accounts processing completed')
    }

    /**
     * Process a single managed account
     */
    public async processManagedAccount(account: Account): Promise<void> {
        const fusionAccount = await this.analyzeManagedAccount(account)

        if (fusionAccount.isMatch) {
            this.log.debug(`Account ${account.name} is a potential duplicate, creating fusion form`)
            const reviewers = this._reviewersBySource.get(fusionAccount.sourceName)
            await this.forms.createFusionForm(fusionAccount, reviewers)
        } else {
            this.log.debug(`Account ${account.name} is not a duplicate, adding to fusion accounts`)
            await this.attributes.refreshUniqueAttributes(fusionAccount)
            this._fusionAccounts.push(fusionAccount)
        }
    }

    /**
     * Analyze all managed accounts
     */
    public async analyzeManagedAccounts(): Promise<void> {
        const managedAccounts = this.sourceService.managedAccounts

        await Promise.all(managedAccounts.map((x: Account) => this.analyzeManagedAccount(x)))
    }

    /**
     * Analyze a single managed account
     */
    public async analyzeManagedAccount(account: Account): Promise<FusionAccount> {
        const fusionAccount = await this.preProcessManagedAccount(account)
        this.scoring.scoreFusionAccount(fusionAccount, this.fusionIdentities)

        return fusionAccount
    }

    // ------------------------------------------------------------------------
    // Public Output/Listing Methods
    // ------------------------------------------------------------------------

    /**
     * List all ISC accounts (fusion accounts and identity accounts)
     */
    public async listISCAccounts(): Promise<StdAccountListOutput[]> {
        return [
            ...this._fusionAccounts.map((x) => this.getISCAccount(x)),
            ...Array.from(this._fusionIdentityMap.values()).map((x) => this.getISCAccount(x)),
        ]
    }

    // ------------------------------------------------------------------------
    // Private Helper Methods
    // ------------------------------------------------------------------------

    /**
     * Pre-process a managed account before processing or analysis
     */
    private async preProcessManagedAccount(account: Account): Promise<FusionAccount> {
        const fusionAccount = FusionAccount.fromManagedAccount(this.config, account)

        const managedAccountsMap = this.sourceService.managedAccountsById
        assert(managedAccountsMap, 'Managed accounts have not been loaded')
        fusionAccount.addManagedAccountLayer(managedAccountsMap)

        this.attributes.mapAttributes(fusionAccount)
        await this.attributes.refreshNonUniqueAttributes(fusionAccount)

        return fusionAccount
    }

    /**
     * Convert a fusion account to ISC account output format
     */
    public getISCAccount(fusionAccount: FusionAccount): StdAccountListOutput {
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

    public get fusionIdentities(): FusionAccount[] {
        return Array.from(this._fusionIdentityMap.values())
    }
}
