import { Account, IdentityDocument } from 'sailpoint-api-client'
import { getDateFromISOString } from '../utils/date'
import { FusionDecision } from './form'
import { FusionConfig, SourceConfig } from './config'
import { Attributes, SimpleKeyType } from '@sailpoint/connector-sdk'
import { COMPOUND_KEY_UNIQUE_ID_ATTRIBUTE } from '../services/attributeService'
import { FusionMatch } from '../services/scoringService'

type AttributeBag = {
    previous: Attributes
    current: Attributes
    identity: Attributes
    accounts: Attributes[]
    sources: Map<string, Attributes[]>
}

// TODO: Limit the size of the history array
export class FusionAccount {
    // ============================================================================
    // Private Fields - All state is encapsulated
    // ============================================================================

    // Core identity fields
    private _type: 'fusion' | 'identity' | 'managed' | 'decision' = 'fusion'
    private _identityId?: string
    private _nativeIdentity?: string
    private _managedAccountId?: string
    private _key?: SimpleKeyType

    // Basic account information
    private _email?: string
    private _name?: string
    private _displayName?: string
    private _sourceName = ''

    // State flags
    private _uncorrelated = false
    private _disabled = false
    private _needsRefresh = false
    private _isMatch = false

    // Collections
    private _accountIds: Set<string> = new Set()
    private _missingAccountIds: Set<string> = new Set()
    private _statuses: Set<string> = new Set()
    private _actions: Set<string> = new Set()
    private _reviews: Set<string> = new Set()
    private _sources: Set<string> = new Set()
    private _previousAccountIds: Set<string> = new Set()
    private _correlationPromises: Array<Promise<unknown>> = []
    private _pendingReviewUrls: Set<string> = new Set()
    private _reviewPromises: Array<Promise<string | undefined>> = []
    private _fusionMatches: FusionMatch[] = []
    private _history: string[] = []

    // Attribute management
    private _attributeBag: AttributeBag = {
        previous: {},
        current: {},
        identity: {},
        accounts: [],
        sources: new Map(),
    }

    // Timestamps
    private _modified: Date = new Date()

    // Read-only configuration (set in constructor)
    private readonly sourceConfigs: SourceConfig[]
    private readonly cloudDisplayName: string
    private readonly fusionAccountRefreshThresholdInSeconds: number

    // ============================================================================
    // Construction
    // ============================================================================

    private constructor(
        sourceConfigs: SourceConfig[],
        cloudDisplayName: string,
        fusionAccountRefreshThresholdInSeconds: number
    ) {
        this.sourceConfigs = sourceConfigs
        this.cloudDisplayName = cloudDisplayName
        this.fusionAccountRefreshThresholdInSeconds = fusionAccountRefreshThresholdInSeconds
    }

    // ============================================================================
    // Factory Methods - Must be first to ensure proper initialization order
    // ============================================================================

    public static fromFusionAccount(config: FusionConfig, account: Account): FusionAccount {
        const fusionAccount = new FusionAccount(
            config.sources,
            config.cloudDisplayName ?? '',
            config.fusionAccountRefreshThresholdInSeconds
        )
        // The ISC Account "id" (stable identifier for the account object)
        fusionAccount._nativeIdentity = account.nativeIdentity as string
        fusionAccount._name = account.name ?? undefined
        fusionAccount._displayName = fusionAccount._name
        fusionAccount._modified = getDateFromISOString(account.modified)
        fusionAccount._disabled = account.disabled ?? false
        fusionAccount._reviews = new Set((account.attributes?.reviews as string[]) || [])
        fusionAccount._statuses = new Set((account.attributes?.statuses as string[]) || [])
        fusionAccount._actions = new Set((account.attributes?.actions as string[]) || [])
        fusionAccount._previousAccountIds = new Set((account.attributes?.accounts as string[]) || [])
        fusionAccount._attributeBag.previous = account.attributes ?? {}
        fusionAccount._attributeBag.previous[COMPOUND_KEY_UNIQUE_ID_ATTRIBUTE] = account.uuid!
        fusionAccount._attributeBag.current = { ...(account.attributes ?? {}) }
        fusionAccount._identityId = account.identityId ?? undefined
        fusionAccount._sourceName = config.cloudDisplayName ?? ''
        if (account.uncorrelated) {
            fusionAccount.setUncorrelated()
        }

        if (fusionAccount._statuses.has('baseline')) {
            fusionAccount._sources.add('Identities')
        }

        return fusionAccount
    }

    public static fromIdentity(config: FusionConfig, identity: IdentityDocument): FusionAccount {
        const fusionAccount = new FusionAccount(
            config.sources,
            config.cloudDisplayName,
            config.fusionAccountRefreshThresholdInSeconds
        )

        fusionAccount._type = 'identity'
        fusionAccount._name = identity.attributes?.displayName ?? identity.name
        fusionAccount._needsRefresh = true
        fusionAccount._disabled = identity.disabled ?? false
        fusionAccount._identityId = identity.id ?? undefined
        fusionAccount._attributeBag.previous = identity.attributes ?? {}
        fusionAccount._sourceName = 'Identities'
        fusionAccount._sources.add('Identities')
        fusionAccount.setBaseline()

        return fusionAccount
    }

    public static fromManagedAccount(config: FusionConfig, account: Account): FusionAccount {
        const fusionAccount = new FusionAccount(
            config.sources,
            config.cloudDisplayName,
            config.fusionAccountRefreshThresholdInSeconds
        )

        fusionAccount._type = 'managed'
        fusionAccount._needsRefresh = true
        fusionAccount._disabled = account.disabled ?? false
        fusionAccount._sourceName = account.sourceName ?? ''
        fusionAccount._name = account.name ?? ''
        fusionAccount._previousAccountIds.add(account.id!)
        fusionAccount._managedAccountId = account.id
        fusionAccount._sources.add(account.sourceName!)
        fusionAccount._statuses = new Set((account.attributes?.statuses as string[]) || [])
        fusionAccount._actions = new Set((account.attributes?.actions as string[]) || [])
        fusionAccount._reviews = new Set((account.attributes?.reviews as string[]) || [])
        fusionAccount.setManagedAccount(account)
        fusionAccount.setUnmatched()
        fusionAccount.setUncorrelated()

        return fusionAccount
    }

    public static fromFusionDecision(config: FusionConfig, decision: FusionDecision): FusionAccount {
        const fusionAccount = new FusionAccount(
            config.sources,
            config.cloudDisplayName,
            config.fusionAccountRefreshThresholdInSeconds
        )

        fusionAccount._type = 'decision'
        fusionAccount._needsRefresh = true
        fusionAccount._sourceName = decision.account.sourceName ?? ''
        fusionAccount._name = decision.account.name ?? ''
        fusionAccount._managedAccountId = decision.account.id
        fusionAccount.setUncorrelated()

        return fusionAccount
    }

    // ============================================================================
    // Accessors - Core Properties
    // ============================================================================

    public get type(): 'fusion' | 'identity' | 'managed' | 'decision' {
        return this._type
    }

    public get identityId(): string | undefined {
        return this._identityId
    }

    public get nativeIdentity(): string {
        return this._nativeIdentity!
    }

    /**
     * Safe nativeIdentity accessor (may be undefined until key is set)
     */
    public get nativeIdentityOrUndefined(): string | undefined {
        return this._nativeIdentity
    }

    /**
     * Stable ISC account id for this source account (may be undefined for non-account FusionAccount types)
     */
    public get managedAccountId(): string | undefined {
        return this._managedAccountId
    }

    public get key(): SimpleKeyType {
        return this._key!
    }

    // ============================================================================
    // Accessors - Account Information
    // ============================================================================

    public get email(): string | undefined {
        return this._email
    }

    public get name(): string | undefined {
        return this._name
    }

    public get displayName(): string | undefined {
        return this._displayName
    }

    public get sourceName(): string {
        return this._sourceName
    }

    // ============================================================================
    // Accessors - State Flags
    // ============================================================================

    public get uncorrelated(): boolean {
        return this._uncorrelated
    }

    public get disabled(): boolean {
        return this._disabled
    }

    public get needsRefresh(): boolean {
        return this._needsRefresh
    }

    public get isMatch(): boolean {
        return this._isMatch
    }

    // ============================================================================
    // Accessors - Collections (return arrays for immutability)
    // ============================================================================

    public get accountIds(): string[] {
        return Array.from(this._accountIds)
    }

    public get missingAccountIds(): string[] {
        return Array.from(this._missingAccountIds)
    }

    public get statuses(): string[] {
        return Array.from(this._statuses)
    }

    public get actions(): string[] {
        return Array.from(this._actions)
    }

    public get reviews(): string[] {
        return Array.from(this._reviews)
    }

    public get sources(): string[] {
        return Array.from(this._sources)
    }

    public get fusionMatches(): FusionMatch[] {
        return [...this._fusionMatches]
    }

    public get history(): string[] {
        return [...this._history]
    }

    // ============================================================================
    // Accessors - Attributes
    // ============================================================================

    public get attributes(): Attributes {
        return this._attributeBag.current
    }

    public get attributeBag(): AttributeBag {
        return this._attributeBag
    }

    public get currentAttributes(): Attributes {
        return this._attributeBag.current
    }

    public get previousAttributes(): Attributes {
        return this._attributeBag.previous
    }

    public get sourceAttributeMap(): Map<string, { [key: string]: any }> {
        const map = new Map<string, { [key: string]: any }>()
        for (const [source, attrsArray] of this._attributeBag.sources.entries()) {
            if (attrsArray.length > 0) {
                map.set(source, attrsArray[0])
            }
        }
        return map
    }

    // ============================================================================
    // Accessors - Internal State (for service layer use)
    // ============================================================================

    public get modified(): Date {
        return this._modified
    }

    public get correlationPromises(): Array<Promise<unknown>> {
        return [...this._correlationPromises]
    }

    public get pendingReviewUrls(): string[] {
        return Array.from(this._pendingReviewUrls)
    }

    // ============================================================================
    // Setters - Core Properties
    // ============================================================================

    public setKey(key: SimpleKeyType): void {
        this._key = key
        this._nativeIdentity = key.simple.id
    }

    // ============================================================================
    // Setters - Account Information
    // ============================================================================

    public setEmail(email: string | undefined): void {
        this._email = email
    }

    public setName(name: string | undefined): void {
        this._name = name
    }

    public setDisplayName(displayName: string | undefined): void {
        this._displayName = displayName
    }

    public setSourceName(sourceName: string): void {
        this._sourceName = sourceName
    }

    // ============================================================================
    // Setters - State Flags
    // ============================================================================

    public enable(): void {
        this._disabled = false
    }

    public disable(): void {
        this._disabled = true
    }

    public setMappedAttributes(attributes: Attributes): void {
        this._attributeBag.current = attributes
    }

    // ============================================================================
    // Mutation Methods - Account IDs
    // ============================================================================

    public addAccountId(id: string, message?: string): void {
        this.addToSet(this._accountIds, id, message)
    }

    public removeAccountId(id: string, message?: string): void {
        this.removeFromSet(this._accountIds, id, message)
    }

    public addMissingAccountId(id: string, message?: string): void {
        this.addToSet(this._missingAccountIds, id, message)
    }

    public removeMissingAccountId(id: string, message?: string): void {
        this.removeFromSet(this._missingAccountIds, id, message)
    }

    // ============================================================================
    // Mutation Methods - Statuses
    // ============================================================================

    public addStatus(status: string, message?: string): void {
        this.addToSet(this._statuses, status, message)
    }

    public removeStatus(status: string, message?: string): void {
        this.removeFromSet(this._statuses, status, message)
    }

    public hasStatus(status: string): boolean {
        return this._statuses.has(status)
    }

    // ============================================================================
    // Mutation Methods - Actions
    // ============================================================================

    public addAction(action: string, message?: string): void {
        this.addToSet(this._actions, action, message)
    }

    public removeAction(action: string, message?: string): void {
        this.removeFromSet(this._actions, action, message)
    }

    public setSourceReviewer(sourceId: string): void {
        this._actions.add(`reviewer:${sourceId}`)
        this.addStatus('reviewer')
    }

    public listReviewerSources(): string[] {
        const reviewerActions = Array.from(this._actions).filter((action) => action.startsWith('reviewer:'))
        const sourceIds = reviewerActions.map((action) => action.split(':')[1])
        return sourceIds
    }

    // ============================================================================
    // Mutation Methods - Reviews
    // ============================================================================

    public addReview(review: string, message?: string): void {
        this.addToSet(this._reviews, review, message)
    }

    public removeReview(review: string, message?: string): void {
        this.removeFromSet(this._reviews, review, message)
    }

    public addFusionReview(reviewUrl: string): void {
        this._reviews.add(reviewUrl)
        this._statuses.add('activeReviews')
    }

    public addPendingReviewUrl(reviewUrl: string): void {
        if (reviewUrl) {
            this._pendingReviewUrls.add(reviewUrl)
        }
    }

    public resolvePendingReviewUrls(): void {
        if (this._pendingReviewUrls.size === 0) {
            return
        }
        for (const url of this._pendingReviewUrls) {
            this.addFusionReview(url)
        }
        this._pendingReviewUrls.clear()
    }

    public addReviewPromise(promise: Promise<string | undefined>): void {
        if (promise) {
            this._reviewPromises.push(promise)
        }
    }

    public async resolvePendingOperations(): Promise<void> {
        if (this._reviewPromises.length > 0) {
            const reviewResults = await Promise.allSettled(this._reviewPromises)
            this._reviewPromises = []
            for (const result of reviewResults) {
                if (result.status === 'fulfilled' && result.value) {
                    this.addPendingReviewUrl(result.value)
                }
            }
        }

        if (this._correlationPromises.length > 0) {
            await Promise.allSettled(this._correlationPromises)
            this._correlationPromises = []
        }

        this.resolvePendingReviewUrls()
    }

    public removeFusionReview(reviewUrl: string): void {
        this._reviews.delete(reviewUrl)
        if (this._reviews.size === 0) {
            this._statuses.delete('activeReviews')
        }
    }

    // ============================================================================
    // Mutation Methods - Sources
    // ============================================================================

    public addSource(source: string, message?: string): void {
        this.addToSet(this._sources, source, message)
    }

    public removeSource(source: string, message?: string): void {
        this.removeFromSet(this._sources, source, message)
    }

    // ============================================================================
    // Mutation Methods - Fusion Matches
    // ============================================================================

    public addFusionMatch(fusionMatch: FusionMatch): void {
        this._fusionMatches.push(fusionMatch)
        this._isMatch = true
    }

    // ============================================================================
    // Mutation Methods - History
    // ============================================================================

    /**
     * Add a dated history entry
     */
    private addHistory(message: string): void {
        const now = new Date().toISOString().split('T')[0]
        const datedMessage = `[${now}] ${message}`
        this._history.push(datedMessage)
    }

    importHistory(history: string[]) {
        this._history = history
    }

    /**
     * Helper method to add an item to a Set and optionally log history
     */
    private addToSet<T>(set: Set<T>, item: T, message?: string): void {
        set.add(item)
        if (message) {
            this.addHistory(message)
        }
    }

    /**
     * Helper method to remove an item from a Set and optionally log history
     * @returns true if the item was removed, false otherwise
     */
    private removeFromSet<T>(set: Set<T>, item: T, message?: string): boolean {
        const removed = set.delete(item)
        if (removed && message) {
            this.addHistory(message)
        }
        return removed
    }

    // ============================================================================
    // Layer Methods - Add data layers (must be called in order)
    // ============================================================================

    public addIdentityLayer(identity: IdentityDocument): void {
        this._email = identity.attributes?.email as string
        this._name = identity.name ?? ''
        this._displayName = identity.attributes?.displayName as string
        this._attributeBag.identity = identity.attributes ?? {}
        this._identityId = identity.id ?? undefined
        const sourceNames = this.sourceConfigs.map((sc) => sc.name)
        identity.accounts?.forEach((account) => {
            if (sourceNames.includes(account.source?.name ?? '')) {
                this.setCorrelatedAccount(account.id!)
            }
        })
    }

    public addManagedAccountLayer(accountsById: Map<string, Account>): void {
        // Collect keys to delete first to avoid modifying map during iteration
        const keysToDelete: string[] = []

        // Use for...of instead of forEach for better control and to ensure we're working with the actual map
        for (const [id, account] of accountsById.entries()) {
            if (this._previousAccountIds.has(id)) {
                this.setManagedAccount(account)
                keysToDelete.push(id)
            } else if (this._identityId && account.identityId === this._identityId) {
                this.setManagedAccount(account)
                keysToDelete.push(id)
            }
        }

        // Delete collected keys after iteration completes
        // This modifies the original map reference passed to this function
        for (const id of keysToDelete) {
            const deleted = accountsById.delete(id)
            if (!deleted) {
                // This should never happen, but helps debug if the map reference is wrong
                console.warn(`Failed to delete key ${id} from map - key may not exist or map reference is wrong`)
            }
        }

        if (this._accountIds.size === 0 && !this._statuses.has('baseline')) {
            this._statuses.add('orphan')
            this._needsRefresh = false
        } else {
            this._statuses.delete('orphan')
        }
    }

    public addFusionDecisionLayer(decision?: FusionDecision): void {
        if (decision) {
            this._previousAccountIds.add(decision.account.id!)
            if (decision.newIdentity) {
                this.setManual(decision)
            } else {
                this.setAuthorized(decision)
                this._identityId = decision.identityId ?? undefined
            }
        }
    }

    // ============================================================================
    // Internal Layer Helpers
    // ============================================================================

    private setManagedAccount(account: Account): void {
        const accountId = account.id!
        if (!this._accountIds.has(accountId)) {
            this._accountIds.add(accountId)
            this.setUncorrelatedAccount(accountId)
        }

        if (!this._needsRefresh) {
            const modified = getDateFromISOString(account.modified)
            const thresholdMs = this.fusionAccountRefreshThresholdInSeconds * 1000
            if (modified.getTime() > this._modified.getTime() + thresholdMs) {
                this._needsRefresh = true
            }
        }

        if (account.sourceName) {
            const existingSourceAccounts = this._attributeBag.sources.get(account.sourceName) || []
            existingSourceAccounts.push(account.attributes ?? {})
            this._sources.delete('Identities')
            this._sources.add(account.sourceName)
            this._attributeBag.sources.set(account.sourceName, existingSourceAccounts)
            this._attributeBag.accounts.push(account.attributes ?? {})
        }
    }

    // ============================================================================
    // Status Setting Methods (private - called by factory methods and layer methods)
    // ============================================================================

    private setUncorrelated(): void {
        this._uncorrelated = true
        this._statuses.add('uncorrelated')
    }

    private setUncorrelatedAccount(accountId?: string): void {
        if (!accountId) return

        this._accountIds.add(accountId)
        this._missingAccountIds.add(accountId)

        this._actions.delete('correlated')
        this._statuses.add('uncorrelated')
    }

    private setBaseline(): void {
        this._statuses.add('baseline')
        this.addHistory(`Set ${this._name} [${this._sourceName}] as baseline`)
    }

    private setUnmatched(): void {
        this._statuses.add('unmatched')
        this.addHistory(`Set ${this._name} [${this._sourceName}] as unmatched`)
    }

    private setManual(decision: FusionDecision): void {
        this._statuses.add('manual')
        const submitterName = decision.submitter.name || decision.submitter.email
        const message = `Created by ${submitterName} from ${decision.account.name} [${decision.account.sourceName}]`
        this.addHistory(message)
    }

    private setAuthorized(decision: FusionDecision): void {
        this._statuses.add('authorized')
        const submitterName = decision.submitter.name || decision.submitter.email
        const message = `${decision.account.name} [${decision.account.sourceName}] authorized by ${submitterName}`
        this.addHistory(message)
    }

    // ============================================================================
    // Correlation Methods
    // ============================================================================

    public setCorrelatedAccount(accountId: string, promise?: Promise<unknown>): void {
        if (promise) {
            this._correlationPromises.push(promise)
        }
        this._missingAccountIds.delete(accountId)

        if (this._missingAccountIds.size === 0) {
            this._statuses.delete('uncorrelated')
            this._actions.add('correlated')
        }
    }

    public addCorrelationPromise(accountId: string, promise: Promise<unknown>): void {
        if (!promise) {
            return
        }
        this._correlationPromises.push(promise)
        promise
            .then(() => {
                this.addHistory(`Missing account ${accountId} correlated`)
            })
            .catch(() => {
                // Ignore errors; correlation is async and shouldn't affect current state
            })
    }

    // ============================================================================
    // Utility Methods
    // ============================================================================

    public isOrphan(): boolean {
        const statuses = this._attributeBag.current.statuses as any
        return statuses instanceof Set ? statuses.has('orphan') : false
    }

    public addFusionDecision(decision: string): void {
        this.addAction(decision, `Fusion decision added: ${decision}`)
    }

    public removeSourceAccount(id: string): void {
        const accounts = this._attributeBag.current.accounts as any
        if (accounts instanceof Set) {
            accounts.delete(id)
            if (accounts.size === 0) {
                if (!this._attributeBag.current.statuses) {
                    this._attributeBag.current.statuses = new Set<string>() as any
                }
                const statuses = this._attributeBag.current.statuses as any
                if (statuses instanceof Set) {
                    statuses.add('orphan')
                }
                this.addHistory(`Account became orphan after removing source account: ${id}`)
            }
        }
        this.addHistory(`Source account removed: ${id}`)
    }

    public generateAttributes(): void {
        // Placeholder for future implementation
    }

    public async editAccount(): Promise<void> {
        // TODO: Edit the account
    }
}
