import { Account, IdentityDocument } from 'sailpoint-api-client'
import { getDateFromISOString } from '../utils/date'
import { toSetFromAttribute as attributeToSet } from '../utils/attributes'
import { FusionDecision } from './form'
import { FusionConfig, SourceConfig } from './config'
import { Attributes, SimpleKeyType } from '@sailpoint/connector-sdk'
import { FusionMatch } from '../services/scoringService'
import { attrSplit } from '../services/attributeService/helpers'

type AttributeBag = {
    previous: Attributes
    current: Attributes
    identity: Attributes
    accounts: Attributes[]
    sources: Map<string, Attributes[]>
}

// TODO: Limit the size of the history array
export class FusionAccount {
    private static config?: FusionConfig

    public static configure(config: FusionConfig): void {
        FusionAccount.config = config
    }
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
    private readonly fusionAccountRefreshThresholdInSeconds: number
    private readonly maxHistoryMessages: number

    // ============================================================================
    // Construction
    // ============================================================================

    private constructor() {
        const config = FusionAccount.config
        if (!config) {
            throw new Error('FusionAccount is not configured. Call FusionAccount.configure(config) first.')
        }
        this.sourceConfigs = config.sources
        this.fusionAccountRefreshThresholdInSeconds = config.fusionAccountRefreshThresholdInSeconds
        this.maxHistoryMessages = config.maxHistoryMessages
    }

    // ============================================================================
    // Factory Methods - Must be first to ensure proper initialization order
    // ============================================================================

    /**
     * Common initialization logic for factory methods.
     * Handles default values internally to avoid repetitive null coalescing in callers.
     */
    private initializeBasicProperties(config: {
        type?: 'fusion' | 'identity' | 'managed' | 'decision'
        name?: string | null
        sourceName?: string | null
        disabled?: boolean | null
        needsRefresh?: boolean
        sources?: string[] | Set<string>
        attributes?: Attributes | null
    }): void {
        if (config.type !== undefined) {
            this._type = config.type
        }
        if (config.name !== undefined) {
            this._name = config.name ?? ''
        }
        if (config.sourceName !== undefined) {
            this._sourceName = config.sourceName ?? ''
        }
        if (config.disabled !== undefined) {
            this._disabled = config.disabled ?? false
        }
        if (config.needsRefresh !== undefined) {
            this._needsRefresh = config.needsRefresh
        }
        if (config.sources !== undefined) {
            this._sources = Array.isArray(config.sources) ? new Set(config.sources) : config.sources
        }
        if (config.attributes !== undefined) {
            this._attributeBag.current = { ...(config.attributes ?? {}) }
        }
    }

    public static fromFusionAccount(account: Account): FusionAccount {
        const fusionAccount = new FusionAccount()

        // Parse sources from attributes
        const sources = attrSplit(account.attributes?.sources ?? '')
        const sourceSet = new Set(sources)

        // Add 'Identities' source if this is a baseline account
        const statuses = attributeToSet(account.attributes, 'statuses')
        if (statuses.has('baseline')) {
            sourceSet.add('Identities')
        }

        // Initialize common properties
        fusionAccount.initializeBasicProperties({
            name: account.name,
            sourceName: account.sourceName,
            disabled: account.disabled,
            sources: sourceSet,
            attributes: account.attributes,
        })

        // The ISC Account "id" (stable identifier for the account object)
        fusionAccount._nativeIdentity = account.nativeIdentity as string
        fusionAccount._displayName = fusionAccount._name
        fusionAccount._modified = getDateFromISOString(account.modified)
        fusionAccount._identityId = account.identityId ?? undefined

        // Initialize collections
        fusionAccount._reviews = attributeToSet(account.attributes, 'reviews')
        fusionAccount._statuses = attributeToSet(account.attributes, 'statuses')
        fusionAccount._actions = attributeToSet(account.attributes, 'actions')
        fusionAccount._previousAccountIds = attributeToSet(account.attributes, 'accounts')

        // Set status flags
        if (account.uncorrelated) {
            fusionAccount.setUncorrelated()
        }

        return fusionAccount
    }

    public static fromIdentity(identity: IdentityDocument): FusionAccount {
        const fusionAccount = new FusionAccount()

        fusionAccount.initializeBasicProperties({
            type: 'identity',
            name: identity.attributes?.displayName ?? identity.name,
            sourceName: 'Identities',
            disabled: identity.disabled,
            needsRefresh: true,
            sources: ['Identities'],
            attributes: identity.attributes,
        })

        fusionAccount._identityId = identity.id ?? undefined
        fusionAccount.setBaseline()

        return fusionAccount
    }

    public static fromManagedAccount(account: Account): FusionAccount {
        const fusionAccount = new FusionAccount()

        fusionAccount.initializeBasicProperties({
            type: 'managed',
            name: account.name,
            sourceName: account.sourceName,
            disabled: account.disabled,
            needsRefresh: true,
        })

        fusionAccount._previousAccountIds.add(account.id!)
        fusionAccount._managedAccountId = account.id
        fusionAccount._statuses = attributeToSet(account.attributes, 'statuses')
        fusionAccount._actions = attributeToSet(account.attributes, 'actions')
        fusionAccount._reviews = attributeToSet(account.attributes, 'reviews')
        fusionAccount.setUnmatched()
        fusionAccount.setUncorrelated()

        return fusionAccount
    }

    public static fromFusionDecision(decision: FusionDecision): FusionAccount {
        const fusionAccount = new FusionAccount()

        fusionAccount.initializeBasicProperties({
            type: 'decision',
            name: decision.account.name,
            sourceName: decision.account.sourceName,
            needsRefresh: true,
        })

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

    public removeFusionReview(reviewUrl: string): void {
        this._reviews.delete(reviewUrl)
        if (this._reviews.size === 0) {
            this._statuses.delete('activeReviews')
        }
    }

    public addPendingReviewUrl(reviewUrl: string): void {
        if (reviewUrl) {
            this._pendingReviewUrls.add(reviewUrl)
        }
    }

    public addReviewPromise(promise: Promise<string | undefined>): void {
        if (promise) {
            this._reviewPromises.push(promise)
        }
    }

    public resolvePendingReviewUrls(): void {
        if (this._pendingReviewUrls.size === 0) return

        for (const url of this._pendingReviewUrls) {
            this.addFusionReview(url)
        }
        this._pendingReviewUrls.clear()
    }

    /**
     * Resolve all pending operations (reviews and correlations)
     */
    public async resolvePendingOperations(): Promise<void> {
        await this.resolveReviewPromises()
        await this.resolveCorrelationPromises()
        this.resolvePendingReviewUrls()
    }

    /**
     * Resolve all pending review promises
     */
    private async resolveReviewPromises(): Promise<void> {
        if (this._reviewPromises.length === 0) return

        const reviewResults = await Promise.allSettled(this._reviewPromises)
        this._reviewPromises = []

        for (const result of reviewResults) {
            if (result.status === 'fulfilled' && result.value) {
                this.addPendingReviewUrl(result.value)
            }
        }
    }

    /**
     * Resolve all pending correlation promises
     */
    private async resolveCorrelationPromises(): Promise<void> {
        if (this._correlationPromises.length === 0) return

        // Wait for all correlation promises to complete
        // setCorrelatedAccount is called in the promise handlers, which updates state
        await Promise.allSettled(this._correlationPromises)
        this._correlationPromises = []
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

        // Enforce maximum history size by keeping only the most recent entries
        if (this._history.length > this.maxHistoryMessages) {
            this._history = this._history.slice(-this.maxHistoryMessages)
        }
    }

    /**
     * Import history from existing account, respecting max history limit
     */
    public importHistory(history: string[]): void {
        this._history = history.slice(-this.maxHistoryMessages)
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
        const keysToDelete = this.processAccountsForLayer(accountsById)
        this.deleteProcessedAccounts(accountsById, keysToDelete)

        // Update orphan status based on final account state
        // An account is orphaned if it has no managed accounts and is not a baseline identity
        if (this._accountIds.size === 0 && !this._statuses.has('baseline')) {
            this._statuses.add('orphan')
            this._needsRefresh = false
        } else {
            this._statuses.delete('orphan')
        }
    }

    /**
     * Process accounts that belong to this fusion account
     * @returns Array of account IDs that were processed and should be removed from the map
     */
    private processAccountsForLayer(accountsById: Map<string, Account>): string[] {
        const keysToDelete: string[] = []

        for (const [id, account] of accountsById.entries()) {
            if (this.shouldProcessAccount(id, account)) {
                this.setManagedAccount(account)
                keysToDelete.push(id)
            }
        }

        return keysToDelete
    }

    /**
     * Determine if an account should be processed for this fusion account
     */
    private shouldProcessAccount(id: string, account: Account): boolean {
        return (
            this._previousAccountIds.has(id) ||
            (this._identityId !== undefined && account.identityId === this._identityId)
        )
    }

    /**
     * Delete processed accounts from the map
     */
    private deleteProcessedAccounts(accountsById: Map<string, Account>, keysToDelete: string[]): void {
        for (const id of keysToDelete) {
            const deleted = accountsById.delete(id)
            if (!deleted) {
                // This should never happen, but helps debug if the map reference is wrong
                console.warn(`Failed to delete key ${id} from map - key may not exist or map reference is wrong`)
            }
        }
    }

    public addFusionDecisionLayer(decision?: FusionDecision): void {
        if (!decision) return

        this._previousAccountIds.add(decision.account.id!)

        if (decision.newIdentity) {
            this.setManual(decision)
        } else {
            this.setAuthorized(decision)
            this._identityId = decision.identityId ?? undefined
        }
    }

    // ============================================================================
    // Internal Layer Helpers
    // ============================================================================

    private setManagedAccount(account: Account): void {
        const accountId = account.id!
        const isNewAccount = !this._accountIds.has(accountId)
        const isCorrelated = this._identityId && account.identityId === this._identityId

        if (isNewAccount) {
            this._accountIds.add(accountId)

            // Check if the account is already correlated (has the same identityId)
            if (isCorrelated) {
                // Account is already correlated - mark as correlated, not missing
                this.setCorrelatedAccount(accountId)
            } else {
                // Account is not correlated yet - mark as uncorrelated/missing
                this.setUncorrelatedAccount(accountId)
            }
        } else if (isCorrelated && this._missingAccountIds.has(accountId)) {
            // Account was previously uncorrelated but is now correlated - update status
            this.setCorrelatedAccount(accountId)
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

    /**
     * Shared logic for setting uncorrelated status
     */
    private setUncorrelatedStatus(): void {
        this._uncorrelated = true
        this._statuses.add('uncorrelated')
        this._actions.delete('correlated')
    }

    private setUncorrelated(): void {
        this.setUncorrelatedStatus()
    }

    private setUncorrelatedAccount(accountId?: string): void {
        if (!accountId) return

        this._accountIds.add(accountId)
        this._missingAccountIds.add(accountId)
        this.setUncorrelatedStatus()
    }

    private setBaseline(): void {
        this._statuses.add('baseline')
        this.addHistory(`Set ${this._name} [${this._sourceName}] as baseline`)
    }

    private setUnmatched(): void {
        this._statuses.add('unmatched')
        this.addHistory(`Set ${this._name} [${this._sourceName}] as unmatched`)
    }

    /**
     * Helper to create history message for decision actions
     */
    private createDecisionHistoryMessage(decision: FusionDecision, action: string): string {
        const submitterName = decision.submitter.name || decision.submitter.email
        const accountInfo = `${decision.account.name} [${decision.account.sourceName}]`

        if (action === 'manual') {
            return `Created by ${submitterName} from ${accountInfo}`
        } else {
            return `${accountInfo} authorized by ${submitterName}`
        }
    }

    private setManual(decision: FusionDecision): void {
        this._statuses.add('manual')
        const message = this.createDecisionHistoryMessage(decision, 'manual')
        this.addHistory(message)
    }

    private setAuthorized(decision: FusionDecision): void {
        this._statuses.add('authorized')
        const message = this.createDecisionHistoryMessage(decision, 'authorized')
        this.addHistory(message)
    }

    // ============================================================================
    // Correlation Methods
    // ============================================================================

    /**
     * Update correlation status and action based on missing accounts
     * Should be called after all layers are added to ensure correct status/action
     */
    public updateCorrelationStatus(): void {
        const hasAllAccountsCorrelated = this._missingAccountIds.size === 0

        if (hasAllAccountsCorrelated) {
            this._statuses.delete('uncorrelated')
            this._actions.add('correlated')
            this._uncorrelated = false
        } else {
            this._statuses.add('uncorrelated')
            this._actions.delete('correlated')
            this._uncorrelated = true
        }
    }

    public setCorrelatedAccount(accountId: string, promise?: Promise<unknown>): void {
        if (promise) {
            this._correlationPromises.push(promise)
        }

        // Remove from missing accounts list and log if successful
        const wasRemoved = this._missingAccountIds.delete(accountId)
        if (wasRemoved) {
            this.addHistory(`Missing account ${accountId} correlated`)
        }

        // Note: Status/action update happens after all correlation promises resolve in getISCAccount
    }

    public addCorrelationPromise(accountId: string, promise: Promise<unknown>): void {
        if (!promise) return

        // Track the promise - it will be resolved in getISCAccount via resolvePendingOperations
        // The promise handler (in correlateAccounts) will call setCorrelatedAccount on success
        this._correlationPromises.push(promise)
    }

    // ============================================================================
    // Utility Methods
    // ============================================================================

    public isOrphan(): boolean {
        return this._statuses.has('orphan')
    }

    public addFusionDecision(decision: string): void {
        this.addAction(decision, `Fusion decision added: ${decision}`)
    }

    /**
     * Remove a source account and update orphan status if needed
     */
    public removeSourceAccount(id: string): void {
        const accounts = this._attributeBag.current.accounts as any

        if (accounts instanceof Set) {
            accounts.delete(id)

            if (accounts.size === 0) {
                this.markAsOrphan()
                this.addHistory(`Account became orphan after removing source account: ${id}`)
            }
        }

        this.addHistory(`Source account removed: ${id}`)
    }

    /**
     * Mark account as orphan by updating statuses
     */
    private markAsOrphan(): void {
        if (!this._attributeBag.current.statuses) {
            this._attributeBag.current.statuses = new Set<string>() as any
        }

        const statuses = this._attributeBag.current.statuses as any
        if (statuses instanceof Set) {
            statuses.add('orphan')
        }
    }

    public generateAttributes(): void {
        // Placeholder for future implementation
    }

    public async editAccount(): Promise<void> {
        // TODO: Edit the account
    }
}
