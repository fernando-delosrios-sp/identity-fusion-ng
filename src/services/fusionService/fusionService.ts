import { Account, IdentityDocument, SourcesV2025ApiUpdateSourceRequest } from 'sailpoint-api-client'
import { StdAccountListOutput } from '@sailpoint/connector-sdk'
import { FusionConfig } from '../../model/config'
import { LogService } from '../logService'
import { FormService } from '../formService'
import { IdentityService } from '../identityService'
import { SourceInfo, SourceService } from '../sourceService'
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
 * Service for identity fusion logic.
 * Pure in-memory operations - no ClientService dependency.
 * All data structures are passed in as parameters.
 */
export class FusionService {
    private _fusionIdentityMap: Map<string, FusionAccount> = new Map()
    private _fusionAccounts: FusionAccount[] = []
    private _reviewersBySourceId: Map<string, Set<FusionAccount>> = new Map()
    private readonly sourcesByName: Map<string, SourceInfo> = new Map()
    private readonly reset: boolean
    private readonly correlateOnAggregation: boolean
    public readonly fusionOwnerIsGlobalReviewer: boolean
    public readonly fusionReportOnAggregation: boolean

    // ------------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------------

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
        this.reset = config.reset
        this.correlateOnAggregation = config.correlateOnAggregation
        this.fusionOwnerIsGlobalReviewer = config.fusionOwnerIsGlobalReviewer ?? false
        this.fusionReportOnAggregation = config.fusionReportOnAggregation ?? false
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
     * Get fusion identity by identity ID
     */
    public getFusionIdentity(identityId: string): FusionAccount | undefined {
        return this._fusionIdentityMap.get(identityId)
    }

    /**
     * Disable the reset flag in the source configuration
     */
    public async disableReset(): Promise<void> {
        const fusionSourceId = this.sources.fusionSourceId
        const requestParameters: SourcesV2025ApiUpdateSourceRequest = {
            id: fusionSourceId,
            jsonPatchOperationV2025: [
                {
                    op: 'replace',
                    path: '/connectorAttributes/reset',
                    value: false,
                },
            ],
        }
        await this.sources.patchSourceConfig(fusionSourceId, requestParameters)
    }

    // ------------------------------------------------------------------------
    // Public Fusion Account Processing Methods
    // ------------------------------------------------------------------------

    /**
     * Pre-process all fusion accounts from sources
     */
    public async preProcessFusionAccounts(): Promise<void> {
        const fusionAccounts = this.sources.fusionAccounts
        await Promise.all(fusionAccounts.map((x: Account) => this.preProcessFusionAccount(x)))
    }

    /**
     * Process all fusion accounts from sources
     */
    public async processFusionAccounts(): Promise<void> {
        const fusionAccounts = this.sources.fusionAccounts
        await Promise.all(fusionAccounts.map((x: Account) => this.processFusionAccount(x)))
    }

    /**
     * Pre-process a single fusion account
     */
    public async preProcessFusionAccount(account: Account): Promise<FusionAccount> {
        assert(
            !this._fusionIdentityMap.has(account.nativeIdentity),
            `Fusion account found for ${account.nativeIdentity}. Should not process Fusion accounts more than once.`
        )

        const fusionAccount = FusionAccount.fromFusionAccount(this.config, account)
        fusionAccount.listReviewerSources().forEach((sourceId) => {
            const reviewers: Set<FusionAccount> = this._reviewersBySourceId.get(sourceId) ?? new Set()
            reviewers.add(fusionAccount)
            this._reviewersBySourceId.set(sourceId, reviewers)
        })

        return fusionAccount
    }

    /**
     * Process a single fusion account
     */
    public async processFusionAccount(account: Account): Promise<FusionAccount> {
        const fusionAccount = await this.preProcessFusionAccount(account)
        const managedAccountsMap = this.sources.managedAccountsById
        assert(managedAccountsMap, 'Managed accounts have not been loaded')
        const identityId = account.identityId!
        const reviewerSourceIds = fusionAccount.listReviewerSources()
        reviewerSourceIds.forEach((sourceId) => {
            this.setReviewerForSource(fusionAccount, sourceId)
        })

        const identity = this.identities.getIdentityById(identityId)
        if (identity) {
            fusionAccount.addIdentityLayer(identity)

            const fusionDecision = this.forms.getAssignmentFusionDecision(identity.attributes?.uid)
            fusionAccount.addFusionDecisionLayer(fusionDecision)
        }

        // Pass the captured map reference directly
        fusionAccount.addManagedAccountLayer(managedAccountsMap)

        // Account edition feature removed: edit decisions are no longer processed

        await this.attributes.registerUniqueAttributes(fusionAccount)
        if (fusionAccount.needsRefresh) {
            this.attributes.mapAttributes(fusionAccount)
            await this.attributes.refreshAttributes(fusionAccount)
        }

        if (account.uncorrelated) {
            this._fusionAccounts.push(fusionAccount)
        } else {
            if (this.correlateOnAggregation) {
                await this.identities.correlateAccounts(fusionAccount)
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
        const { managedSources } = this.sources
        managedSources.forEach((source) => {
            this.sourcesByName.set(source.name, source)
        })

        if (this.fusionOwnerIsGlobalReviewer) {
            const { fusionSourceOwner } = this.sources

            const globalReviewer = this._fusionIdentityMap.get(fusionSourceOwner.id!)
            if (globalReviewer) {
                managedSources.forEach((source) => {
                    this.setReviewerForSource(globalReviewer, source.id!)
                })
            }
        }
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

            const managedAccountsMap = this.sources.managedAccountsById
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
        let fusionAccount: FusionAccount
        if (fusionDecision.newIdentity) {
            fusionAccount = FusionAccount.fromFusionDecision(this.config, fusionDecision)
            fusionAccount.addFusionDecisionLayer(fusionDecision)
            const managedAccountsMap = this.sources.managedAccountsById!
            fusionAccount.addManagedAccountLayer(managedAccountsMap)
            this._fusionAccounts.push(fusionAccount)
        } else {
            fusionAccount = this._fusionIdentityMap.get(fusionDecision.identityId!)!
            assert(fusionAccount, 'Fusion account not found')
            fusionAccount.addFusionDecisionLayer(fusionDecision)
        }

        this.attributes.mapAttributes(fusionAccount)
        await this.attributes.refreshAttributes(fusionAccount)
    }

    // ------------------------------------------------------------------------
    // Public Managed Account Processing Methods
    // ------------------------------------------------------------------------

    /**
     * Process all managed accounts
     */
    public async processManagedAccounts(): Promise<void> {
        const { managedAccounts } = this.sources

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
            this.log.debug(
                `Account ${account.name} [${fusionAccount.sourceName}] is a potential duplicate, creating fusion form`
            )

            const sourceInfo = this.sourcesByName.get(fusionAccount.sourceName)
            assert(sourceInfo, 'Source info not found')
            const reviewers = this._reviewersBySourceId.get(sourceInfo.id!)
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
        const { managedAccounts } = this.sources

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

    private setReviewerForSource(fusionAccount: FusionAccount, sourceId: string): void {
        fusionAccount.setSourceReviewer(sourceId)
        const reviewers: Set<FusionAccount> = this._reviewersBySourceId.get(sourceId) ?? new Set()
        reviewers.add(fusionAccount)
        this._reviewersBySourceId.set(sourceId, reviewers)
    }

    /**
     * Pre-process a managed account before processing or analysis
     */
    private async preProcessManagedAccount(account: Account): Promise<FusionAccount> {
        const fusionAccount = FusionAccount.fromManagedAccount(this.config, account)

        const managedAccountsMap = this.sources.managedAccountsById
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

    public generateReport(): FusionReport {
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
}
