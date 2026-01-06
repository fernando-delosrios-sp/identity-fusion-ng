import { Account, IdentityDocument } from 'sailpoint-api-client'
import { SimpleKeyType, StdAccountListOutput } from '@sailpoint/connector-sdk'
import { FusionConfig } from '../model/config'
import { LogService } from './logService'
import { AccountService } from './accountService'
import { FormService } from './formService'
import { IdentityService } from './identityService'
import { FusionAccount } from '../model/account'
import { AttributeService } from './attributeService'
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
        private accounts: AccountService,
        private forms: FormService,
        private attributes: AttributeService,
        private scoring: ScoringService,
        private schemas: SchemaService
    ) {
        // TODO: Use assertion + getter instead
        this.config.sources.forEach((source) => {
            this._reviewersBySource.set(source, new Set())
        })
    }

    public checkAttributeDefinitions(): void {
        const { fusionIdentityAttribute } = this.schemas
        if (!this.attributes.hasAttributeDefinition(fusionIdentityAttribute)) {
            this.attributes.addAttributeDefinition({
                name: fusionIdentityAttribute,
                type: 'uuid',
                normalize: false,
                spaces: false,
                refresh: false,
                values: new Set(),
            })
        }
    }

    public async processFusionAccounts(): Promise<void> {
        const { fusionAccounts } = this.accounts
        this.log.debug(`Processing ${fusionAccounts.length} fusion account(s)`)
        await Promise.all(fusionAccounts.map((x) => this.processFusionAccount(x)))
        this.log.debug('Fusion accounts processing completed')
    }

    public async processFusionAccount(account: Account): Promise<FusionAccount> {
        assert(
            !this._fusionIdentityMap.has(account.nativeIdentity),
            `Fusion account found for ${account.nativeIdentity}. Should not process Fusion accounts more than once.`
        )
        const identityId = account.identityId
        assert(identityId, `Identity ID not found for ${account.name}`)
        const identity = this.identities.getIdentityById(identityId)
        assert(identity, `Identity not found for ${account.name}`)

        const fusionAccount = FusionAccount.fromFusionAccount(this.config, account)
        fusionAccount.reviewerForSources().forEach((source) => {
            this._reviewersBySource.get(source)?.add(fusionAccount)
        })

        fusionAccount.addIdentityLayer(identity)

        const fusionDecision = this.forms.getAssignmentFusionDecision(identity.attributes?.uid)
        fusionAccount.addFusionDecisionLayer(fusionDecision)

        const { managedAccountsById } = this.accounts
        fusionAccount.addManagedAccountLayer(managedAccountsById)

        const editDecision = this.forms.getEditDecision(identity.attributes?.uid)
        fusionAccount.addEditDecisionLayer(editDecision)

        if (fusionAccount.needsRefresh) {
            this.attributes.mapAttributes(fusionAccount)
            await this.attributes.refreshNonUniqueAttributes(fusionAccount)
        }
        await this.attributes.registerUniqueAttributes(fusionAccount)

        this._fusionIdentityMap.set(identityId, fusionAccount)

        return fusionAccount
    }

    public async processIdentities(): Promise<void> {
        const { identities } = this.identities
        this.log.debug(`Processing ${identities.length} identity/identities`)
        await Promise.all(identities.map((x) => this.processIdentity(x)))
        this.log.debug('Identities processing completed')
    }

    public async processIdentity(identity: IdentityDocument): Promise<void> {
        const identityId = identity.id

        if (!this._fusionIdentityMap.has(identityId)) {
            const fusionAccount = FusionAccount.fromIdentity(this.config, identity)
            fusionAccount.addIdentityLayer(identity)

            const { managedAccountsById } = this.accounts
            fusionAccount.addManagedAccountLayer(managedAccountsById)

            this.attributes.mapAttributes(fusionAccount)
            await this.attributes.refreshAttributes(fusionAccount)

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

        const { managedAccountsById } = this.accounts
        fusionAccount.addManagedAccountLayer(managedAccountsById)

        this.attributes.mapAttributes(fusionAccount)
        this.attributes.refreshAttributes(fusionAccount)

        this._fusionAccounts.push(fusionAccount)
    }

    public async processManagedAccounts(): Promise<void> {
        const { managedAccountsById } = this.accounts
        const managedAccounts = Array.from(managedAccountsById.values())

        this.log.debug(`Processing ${managedAccounts.length} managed account(s)`)
        await Promise.all(managedAccounts.map((x) => this.processManagedAccount(x)))
        this.log.debug('Managed accounts processing completed')
    }

    public async analyzeManagedAccounts(): Promise<void> {
        const { managedAccountsById } = this.accounts
        const managedAccounts = Array.from(managedAccountsById.values())

        await Promise.all(managedAccounts.map((x) => this.analyzeManagedAccount(x)))
    }

    private async preProcessManagedAccount(account: Account): Promise<FusionAccount> {
        const fusionAccount = FusionAccount.fromManagedAccount(this.config, account)
        const fusionIdentities = Array.from(this._fusionAccounts.values())

        const { managedAccountsById } = this.accounts
        fusionAccount.addManagedAccountLayer(managedAccountsById)

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
        const { fusionIdentityAttribute } = this.schemas
        const attributes = fusionAccount.attributes
        const id = attributes[fusionIdentityAttribute] as string
        return {
            key: createKey(id),
            attributes,
        }
    }

    public listISCAccounts(): StdAccountListOutput[] {
        return [
            ...this._fusionAccounts.map(this.getISCAccount),
            ...Array.from(this._fusionIdentityMap.values()).map(this.getISCAccount),
        ]
    }
}

export const createKey = (id: string): SimpleKeyType => {
    return {
        simple: {
            id,
        },
    }
}
