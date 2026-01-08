import { Account, IdentityDocument } from 'sailpoint-api-client'
import { getDateFromISOString } from '../utils/date'
import { FusionDecision } from './form'
import { FusionConfig } from './config'
import { Attributes, StdAccountListOutput } from '@sailpoint/connector-sdk'

export type SimilarAccountMatch = {
    identity: IdentityDocument
    score: Map<string, string>
}

export type AccountAnalysis = {
    account: Account
    results: string[]
    identicalMatch: IdentityDocument | undefined
    similarMatches: SimilarAccountMatch[]
}

type AttributeBag = {
    previous: Attributes
    current: Attributes
    identity: Attributes
    accounts: Attributes[]
    sources: Map<string, Attributes[]>
}

// TODO: Limit the size of the history array
export class FusionAccount {
    private _attributeBag: AttributeBag = {
        previous: {},
        current: {},
        identity: {},
        accounts: [],
        sources: new Map(),
    }
    public duplicate: boolean = false
    private _potentialDuplicates: FusionAccount[] = []
    public disabled: boolean = false
    private _needsRefresh: boolean = false
    private _type: 'fusion' | 'identity' | 'managed' | 'decision' = 'fusion'
    public history: string[] = []
    public accountIds: Set<string> = new Set()
    private _previousAccountIds: Set<string> = new Set()
    public missingAccountIds: Set<string> = new Set()
    private _modified: Date = new Date()
    private _identityId: string = ''
    public email?: string
    public name?: string
    public displayName?: string
    public sourceName: string = ''
    private _nativeIdentity: string = ''
    public statuses: Set<string> = new Set()
    public actions: Set<string> = new Set()
    public reviews: Set<string> = new Set()
    public sources: Set<string> = new Set()
    private _correlationPromises: Promise<void>[] = []

    private constructor(private config: FusionConfig) {}

    get type(): 'fusion' | 'identity' | 'managed' | 'decision' {
        return this._type
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

    private addHistory(message: string): void {
        const now = new Date().toISOString().split('T')[0]
        const datedMessage = `[${now}] ${message}`
        this.history.push(datedMessage)
    }

    public static fromFusionAccount(config: FusionConfig, account: Account): FusionAccount {
        const fusionAccount = new FusionAccount(config)
        fusionAccount._nativeIdentity = account.nativeIdentity
        fusionAccount.name = account.name ?? undefined
        fusionAccount.displayName = fusionAccount.name
        fusionAccount._modified = getDateFromISOString(account.modified)
        fusionAccount.disabled = account.disabled ?? false
        fusionAccount.statuses = new Set((account.attributes?.statuses as string[]) || [])
        fusionAccount.actions = new Set((account.attributes?.actions as string[]) || [])
        fusionAccount.sources = new Set((account.attributes?.sources as string[]) || [])
        fusionAccount.history = account.attributes?.history ?? []
        fusionAccount._previousAccountIds = new Set((account.attributes?.accounts as string[]) || [])
        fusionAccount._attributeBag.previous = account.attributes ?? {}
        fusionAccount._attributeBag.current = { ...(account.attributes ?? {}) }
        fusionAccount._identityId = account.identityId ?? ''
        fusionAccount.sourceName = config.cloudDisplayName ?? ''

        return fusionAccount
    }

    public static fromIdentity(config: FusionConfig, identity: IdentityDocument): FusionAccount {
        const fusionAccount = new FusionAccount(config)

        fusionAccount._type = 'identity'
        fusionAccount.name = identity.name
        fusionAccount._needsRefresh = true
        fusionAccount.disabled = identity.disabled ?? false
        fusionAccount._identityId = identity.id ?? ''
        fusionAccount.sourceName = 'Identities'
        fusionAccount.sources.add('Identities')
        fusionAccount.setBaseline()

        return fusionAccount
    }

    public static fromFusionDecision(config: FusionConfig, decision: FusionDecision): FusionAccount {
        const fusionAccount = new FusionAccount(config)

        fusionAccount._type = 'decision'
        fusionAccount._needsRefresh = true
        fusionAccount.sourceName = decision.account.sourceName ?? ''
        fusionAccount.name = decision.account.name ?? ''
        // set decision

        return fusionAccount
    }

    public static fromManagedAccount(config: FusionConfig, account: Account): FusionAccount {
        const fusionAccount = new FusionAccount(config)

        fusionAccount._type = 'managed'
        fusionAccount._needsRefresh = true
        fusionAccount.disabled = account.disabled ?? false
        fusionAccount.sourceName = account.sourceName ?? ''
        fusionAccount.name = account.name ?? ''
        fusionAccount.setManagedAccount(account)
        fusionAccount.sources.add(account.sourceName!)
        fusionAccount.setUnmatched()

        return fusionAccount
    }

    public addIdentityLayer(identity: IdentityDocument): void {
        this.email = identity.attributes?.email as string
        this.name = identity.name ?? ''
        this.displayName = identity.attributes?.displayName as string
        this._attributeBag.identity = identity.attributes ?? {}
        this._identityId = identity.id ?? ''
        const sourceNames = this.config.sources.map((sc) => sc.name)
        identity.accounts?.forEach((account) => {
            if (sourceNames.includes(account.source?.name ?? '')) {
                this.setCorrelatedAccount(account.id)
            }
        })
    }

    public addManagedAccountLayer(accountsById: Map<string, Account>): void {
        accountsById.forEach((account, id) => {
            if (this._previousAccountIds.has(id)) {
                this.setManagedAccount(account)
                accountsById.delete(id)
            } else if (account.identityId === this.identityId) {
                this.setManagedAccount(account)
                accountsById.delete(id)
            }
        })

        if (this.accountIds.size === 0 && !this.statuses.has('baseline')) {
            this.statuses.add('orphan')
            this._needsRefresh = false
        } else {
            this.statuses.delete('orphan')
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

    public addEditDecisionLayer(decision?: any): void {
        if (decision) {
            this.statuses.add('edited')
            this._needsRefresh = false
            this._attributeBag.current = decision
        }
    }

    private setManagedAccount(account: Account): void {
        const accountId = account.id!
        if (!this.accountIds.has(accountId)) {
            this.accountIds.add(accountId)
            this.setUncorrelatedAccount(accountId)
        }

        if (!this._needsRefresh) {
            const modified = getDateFromISOString(account.modified)
            const thresholdMs = this.config.fusionAccountRefreshThresholdInSeconds * 1000
            if (modified.getTime() > this._modified.getTime() + thresholdMs) {
                this._needsRefresh = true
            }
        }

        if (account.sourceName) {
            const existingSourceAccounts = this._attributeBag.sources.get(account.sourceName) || []
            existingSourceAccounts.push(account.attributes ?? {})
            this.sources.delete('Identities')
            this.sources.add(account.sourceName)
            this._attributeBag.sources.set(account.sourceName, existingSourceAccounts)
            this._attributeBag.accounts.push(account.attributes ?? {})
        }
    }

    private setCorrelatedAccount(accountId?: string): void {
        if (!accountId) return

        this.accountIds.add(accountId)
        this.missingAccountIds.delete(accountId)

        if (this.missingAccountIds.size === 0) {
            this.statuses.delete('uncorrelated')
            this.statuses.add('correlated')
        }
    }

    private setUncorrelatedAccount(accountId?: string): void {
        if (!accountId) return

        this.accountIds.add(accountId)
        this.missingAccountIds.add(accountId)

        this.statuses.delete('correlated')
        this.statuses.add('uncorrelated')
    }

    public reviewerForSources(): string[] {
        const sourceNames = this.config.sources.map((sc) => sc.name)
        return sourceNames.filter((source) => this.actions.has(source))
    }

    /**
     * Get the native identity (used as primary key in IndexedCollection)
     */
    public get nativeIdentity(): string {
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
        this.statuses.add('edited')
    }

    private unsetEdited(message: string) {
        this.statuses.delete('edited')
        this.addHistory(message)
    }

    private setBaseline() {
        this.statuses.add('baseline')
        this.addHistory(`Set ${this.name} (${this.sourceName}) as baseline`)
    }

    private setUnmatched() {
        this.statuses.add('unmatched')
        this.addHistory(`Set ${this.name} (${this.sourceName}) as unmatched`)
    }

    private setManual(decision: FusionDecision) {
        this.statuses.add('manual')
        const submitterName = decision.submitter.name || decision.submitter.email
        const message = `Created by ${submitterName} from ${decision.account.name} [${decision.account.sourceName}]`
        this.addHistory(message)
    }

    private setAuthorized(decision: FusionDecision) {
        this.statuses.add('authorized')
        const submitterName = decision.submitter.name || decision.submitter.email
        const message = `${decision.account.name} [${decision.account.sourceName}] authorized by ${submitterName}`
        this.addHistory(message)
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
        this.missingAccountIds.forEach(async (id) => {
            this._correlationPromises.push(this.correlateMissingAccount(id, fn))
        })
    }

    private async correlateMissingAccount(
        accountId: string,
        fn: (accountId: string, identityId: string) => Promise<boolean>
    ): Promise<void> {
        if (await fn(accountId, this.identityId)) {
            this.missingAccountIds.delete(accountId)
            this.addHistory(`Missing account ${accountId} correlated`)
        }
    }

    public setAttributes(attributes: { [key: string]: any }) {
        this._attributeBag.current = { ...this._attributeBag.current, ...attributes }
        this.setEdited()
        this.addHistory(`Attributes set: ${JSON.stringify(attributes)}`)
    }

    public addFusionDecision(decision: string): void {
        this.actions.add(decision)
        this.addHistory(`Fusion decision added: ${decision}`)
    }

    public generateAttributes(): void {}

    public async editAccount() {
        // TODO: Edit the account
    }

    public async getISCAccount(): Promise<StdAccountListOutput> {
        Promise.all(this._correlationPromises)
        return {
            key: {
                simple: {
                    id: this.nativeIdentity,
                },
            },
            attributes: this.attributeBag.current,
        }
    }

    public enable(): void {
        this.disabled = false
    }

    public disable(): void {
        this.disabled = true
    }
}
