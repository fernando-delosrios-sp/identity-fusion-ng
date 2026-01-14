import { Account, IdentityDocument } from 'sailpoint-api-client'
import { getDateFromISOString } from '../utils/date'
import { FusionDecision } from './form'
import { FusionConfig, SourceConfig } from './config'
import { Attributes } from '@sailpoint/connector-sdk'
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
    // ------------------------------------------------------------------------
    // Public state
    // ------------------------------------------------------------------------

    public duplicate = false
    public disabled = false

    public history: string[] = []

    public email?: string
    public name?: string
    public displayName?: string
    public sourceName = ''

    private _accountIds: Set<string> = new Set()
    private _missingAccountIds: Set<string> = new Set()
    private _statuses: Set<string> = new Set()
    private _actions: Set<string> = new Set()
    private _reviews: Set<string> = new Set()
    private _sources: Set<string> = new Set()

    public fusionMatches: FusionMatch[] = []

    // ------------------------------------------------------------------------
    // Private backing fields (use leading "_" only for fields with accessors)
    // ------------------------------------------------------------------------

    private _attributeBag: AttributeBag = {
        previous: {},
        current: {},
        identity: {},
        accounts: [],
        sources: new Map(),
    }

    private _needsRefresh = false
    private _type: 'fusion' | 'identity' | 'managed' | 'decision' = 'fusion'

    private _previousAccountIds: Set<string> = new Set()
    private _modified: Date = new Date()
    private _identityId = ''
    private _nativeIdentity?: string

    private _correlationPromises: Promise<void>[] = []
    private _isMatch = false

    // ------------------------------------------------------------------------
    // Construction
    // ------------------------------------------------------------------------

    private constructor(
        private readonly sourceConfigs: SourceConfig[],
        private readonly cloudDisplayName: string,
        private readonly fusionAccountRefreshThresholdInSeconds: number
    ) {}

    // ------------------------------------------------------------------------
    // Basic accessors
    // ------------------------------------------------------------------------

    get type(): 'fusion' | 'identity' | 'managed' | 'decision' {
        return this._type
    }

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

    public get attributeBag(): AttributeBag {
        return this._attributeBag
    }

    public get attributes(): Attributes {
        return this._attributeBag.current
    }

    public get identityId(): string {
        return this._identityId
    }

    // ------------------------------------------------------------------------
    // Set mutation helpers with optional history messages
    // ------------------------------------------------------------------------

    public addAccountId(id: string, message?: string): void {
        this._accountIds.add(id)
        if (message) {
            this.addHistory(message)
        }
    }

    public removeAccountId(id: string, message?: string): void {
        if (this._accountIds.delete(id) && message) {
            this.addHistory(message)
        }
    }

    public addMissingAccountId(id: string, message?: string): void {
        this._missingAccountIds.add(id)
        if (message) {
            this.addHistory(message)
        }
    }

    public removeMissingAccountId(id: string, message?: string): void {
        if (this._missingAccountIds.delete(id) && message) {
            this.addHistory(message)
        }
    }

    public addStatus(status: string, message?: string): void {
        this._statuses.add(status)
        if (message) {
            this.addHistory(message)
        }
    }

    public removeStatus(status: string, message?: string): void {
        if (this._statuses.delete(status) && message) {
            this.addHistory(message)
        }
    }

    public addAction(action: string, message?: string): void {
        this._actions.add(action)
        if (message) {
            this.addHistory(message)
        }
    }

    public removeAction(action: string, message?: string): void {
        if (this._actions.delete(action) && message) {
            this.addHistory(message)
        }
    }

    public addReview(review: string, message?: string): void {
        this._reviews.add(review)
        if (message) {
            this.addHistory(message)
        }
    }

    public removeReview(review: string, message?: string): void {
        if (this._reviews.delete(review) && message) {
            this.addHistory(message)
        }
    }

    public addSource(source: string, message?: string): void {
        this._sources.add(source)
        if (message) {
            this.addHistory(message)
        }
    }

    public removeSource(source: string, message?: string): void {
        if (this._sources.delete(source) && message) {
            this.addHistory(message)
        }
    }

    // ------------------------------------------------------------------------
    // Core mutation helpers
    // ------------------------------------------------------------------------

    public addFusionMatch(fusionMatch: FusionMatch): void {
        this.fusionMatches.push(fusionMatch)
        this._isMatch = true
    }

    private addHistory(message: string): void {
        const now = new Date().toISOString().split('T')[0]
        const datedMessage = `[${now}] ${message}`
        this.history.push(datedMessage)
    }

    public static fromFusionAccount(config: FusionConfig, account: Account): FusionAccount {
        const fusionAccount = new FusionAccount(
            config.sources,
            config.cloudDisplayName ?? '',
            config.fusionAccountRefreshThresholdInSeconds
        )
        fusionAccount._nativeIdentity = account.nativeIdentity
        fusionAccount.name = account.name ?? undefined
        fusionAccount.displayName = fusionAccount.name
        fusionAccount._modified = getDateFromISOString(account.modified)
        fusionAccount.disabled = account.disabled ?? false
        fusionAccount._statuses = new Set((account.attributes?.statuses as string[]) || [])
        fusionAccount._actions = new Set((account.attributes?.actions as string[]) || [])
        fusionAccount._reviews = new Set((account.attributes?.reviews as string[]) || [])
        fusionAccount.history = account.attributes?.history ?? []
        fusionAccount._previousAccountIds = new Set((account.attributes?.accounts as string[]) || [])
        fusionAccount._attributeBag.previous = account.attributes ?? {}
        fusionAccount._attributeBag.previous[COMPOUND_KEY_UNIQUE_ID_ATTRIBUTE] = account.uuid!
        fusionAccount._attributeBag.current = { ...(account.attributes ?? {}) }
        fusionAccount._identityId = account.identityId ?? ''
        fusionAccount.sourceName = config.cloudDisplayName ?? ''

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
        fusionAccount.name = identity.name
        fusionAccount._needsRefresh = true
        fusionAccount.disabled = identity.disabled ?? false
        fusionAccount._identityId = identity.id ?? ''
        fusionAccount._attributeBag.previous = identity.attributes ?? {}
        fusionAccount.sourceName = 'Identities'
        fusionAccount._sources.add('Identities')
        fusionAccount.setBaseline()

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
        fusionAccount.sourceName = decision.account.sourceName ?? ''
        fusionAccount.name = decision.account.name ?? ''
        // set decision

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
        fusionAccount.disabled = account.disabled ?? false
        fusionAccount.sourceName = account.sourceName ?? ''
        fusionAccount.name = account.name ?? ''
        fusionAccount._previousAccountIds.add(account.id!)
        fusionAccount.setManagedAccount(account)
        fusionAccount._sources.add(account.sourceName!)
        fusionAccount.setUnmatched()

        return fusionAccount
    }

    public addIdentityLayer(identity: IdentityDocument): void {
        this.email = identity.attributes?.email as string
        this.name = identity.name ?? ''
        this.displayName = identity.attributes?.displayName as string
        this._attributeBag.identity = identity.attributes ?? {}
        this._identityId = identity.id ?? ''
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
            } else if (account.identityId === this.identityId) {
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
                this._identityId = decision.identityId ?? ''
            }
        }
    }

    // Account edition feature removed: edit decisions are no longer applied

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

    public setCorrelatedAccount(accountId: string, promise?: Promise<any>): void {
        if (promise) {
            this._correlationPromises.push(promise)
            this.addHistory(`Missing account ${accountId} correlated`)
        }
        this._missingAccountIds.delete(accountId)

        if (this._missingAccountIds.size === 0) {
            this._statuses.delete('uncorrelated')
            this._actions.add('correlated')
        }
    }

    private setUncorrelatedAccount(accountId?: string): void {
        if (!accountId) return

        this._accountIds.add(accountId)
        this._missingAccountIds.add(accountId)

        this._actions.delete('correlated')
        this._statuses.add('uncorrelated')
    }

    public listReviewerSources(): string[] {
        const reviewerActions = Array.from(this._actions).filter((action) => action.startsWith('reviewer:'))
        const sourceIds = reviewerActions.map((action) => action.split(':')[1])

        return sourceIds
    }

    /**
     * Get the native identity (used as primary key in IndexedCollection)
     */
    public get nativeIdentity(): string | undefined {
        return this._nativeIdentity
    }

    /**
     * Get source attribute map for attribute mapping
     * Returns a Map where each source maps to its attributes (first item from the array)
     */
    public get sourceAttributeMap(): Map<string, { [key: string]: any }> {
        const map = new Map<string, { [key: string]: any }>()
        for (const [source, attrsArray] of this._attributeBag.sources.entries()) {
            if (attrsArray.length > 0) {
                map.set(source, attrsArray[0])
            }
        }
        return map
    }

    /**
     * Get previous attributes to use as defaults
     */
    public get previousAttributes(): { [key: string]: any } {
        return this._attributeBag.previous
    }

    /**
     * Check if account needs refresh
     */
    public get needsRefresh(): boolean {
        return this._needsRefresh
    }

    /**
     * Get current attributes
     */
    public get currentAttributes(): { [key: string]: any } {
        return this._attributeBag.current
    }

    /**
     * Set mapped attributes (used by AttributeService)
     */
    public setMappedAttributes(attributes: { [key: string]: any }): void {
        this._attributeBag.current = attributes
    }

    public isOrphan(): boolean {
        const statuses = this._attributeBag.current.statuses as any
        return statuses instanceof Set ? statuses.has('orphan') : false
    }

    private setEdited() {
        this._statuses.add('edited')
    }

    private unsetEdited(message: string) {
        this._statuses.delete('edited')
        this.addHistory(message)
    }

    private setBaseline() {
        this._statuses.add('baseline')
        this.addHistory(`Set ${this.name} [${this.sourceName}] as baseline`)
    }

    private setUnmatched() {
        this._statuses.add('unmatched')
        this.addHistory(`Set ${this.name} [${this.sourceName}] as unmatched`)
    }

    private setManual(decision: FusionDecision) {
        this._statuses.add('manual')
        const submitterName = decision.submitter.name || decision.submitter.email
        const message = `Created by ${submitterName} from ${decision.account.name} [${decision.account.sourceName}]`
        this.addHistory(message)
    }

    private setAuthorized(decision: FusionDecision) {
        this._statuses.add('authorized')
        const submitterName = decision.submitter.name || decision.submitter.email
        const message = `${decision.account.name} [${decision.account.sourceName}] authorized by ${submitterName}`
        this.addHistory(message)
    }

    public setSourceReviewer(sourceId: string): void {
        this._actions.add(`reviewer:${sourceId}`)
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

    public async correlateMissingAccounts(
        fn: (accountId: string, identityId: string) => Promise<boolean>
    ): Promise<void> {
        this._missingAccountIds.forEach(async (id) => {
            this._correlationPromises.push(this.correlateMissingAccount(id, fn))
        })
    }

    public async correlateMissingAccount(
        accountId: string,
        fn: (accountId: string, identityId: string) => Promise<boolean>
    ): Promise<void> {
        if (await fn(accountId, this.identityId)) {
            this._missingAccountIds.delete(accountId)
            this.addHistory(`Missing account ${accountId} correlated`)
        }
    }

    public setAttributes(attributes: { [key: string]: any }) {
        this._attributeBag.current = { ...this._attributeBag.current, ...attributes }
        this.setEdited()
        this.addHistory(`Attributes set: ${JSON.stringify(attributes)}`)
    }

    public addFusionDecision(decision: string): void {
        this.addAction(decision, `Fusion decision added: ${decision}`)
    }

    public generateAttributes(): void {}

    public async editAccount() {
        // TODO: Edit the account
    }

    public enable(): void {
        this.disabled = false
    }

    public disable(): void {
        this.disabled = true
    }

    public get isMatch(): boolean {
        return this._isMatch
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
}
