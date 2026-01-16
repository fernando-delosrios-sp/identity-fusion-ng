import {
    FormDefinitionResponseV2025,
    FormInstanceResponseV2025,
    CreateFormInstanceRequestV2025,
    FormInstanceCreatedByV2025,
    FormInstanceRecipientV2025,
    FormInstanceResponseV2025StateV2025,
    CustomFormsV2025ApiSearchFormDefinitionsByTenantRequest,
    CustomFormsV2025ApiCreateFormDefinitionRequest,
    CustomFormsV2025ApiCreateFormInstanceRequest,
    CustomFormsV2025ApiPatchFormInstanceRequest,
    OwnerDto,
    FormElementV2025,
    FormDefinitionInputV2025,
} from 'sailpoint-api-client'
import { RawAxiosRequestConfig } from 'axios'
import { FusionConfig } from '../model/config'
import { ClientService } from './clientService'
import { LogService } from './logService'
import { IdentityService } from './identityService'
import { MessagingService } from './messagingService'
import { SourceService } from './sourceService'
import { assert } from '../utils/assert'
import { capitalizeFirst, toLowerFirstChar, buildAccountIdentifier } from '../utils/attributes'
import { FusionDecision } from '../model/form'
import { FusionAccount } from '../model/account'

// ============================================================================
// FormService Class
// ============================================================================

/**
 * Service for form definition and instance management.
 * Handles creation, processing, and cleanup of fusion forms for deduplication review.
 */
export class FormService {
    private _formsToDelete: string[] = []
    private _fusionIdentityDecisions?: FusionDecision[]
    private _fusionAssignmentDecisionMap?: Map<string, FusionDecision>
    private readonly fusionFormNamePattern: string
    private readonly fusionFormExpirationDays: number
    private readonly fusionFormAttributes?: string[]

    // Friendly algorithm names (aligned with connector-spec.json)
    private static readonly ALGORITHM_LABELS: Record<string, string> = {
        'name-matcher': 'Enhanced Name Matcher',
        'jaro-winkler': 'Jaro-Winkler',
        dice: 'Dice',
        'double-metaphone': 'Double Metaphone',
        custom: 'Custom Algorithm (from SaaS customizer)',
        average: 'Average Score',
    }

    // ------------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------------

    constructor(
        config: FusionConfig,
        private log: LogService,
        private client: ClientService,
        private sources: SourceService,
        private identities?: IdentityService,
        private messaging?: MessagingService
    ) {
        this.fusionFormNamePattern = config.fusionFormNamePattern
        this.fusionFormExpirationDays = config.fusionFormExpirationDays
        this.fusionFormAttributes = config.fusionFormAttributes
    }

    // ------------------------------------------------------------------------
    // Public Methods
    // ------------------------------------------------------------------------

    /**
     * Fetch and process form data from completed form instances
     */
    public async fetchFormData(): Promise<void> {
        this.log.debug('Fetching form data')
        assert(this.fusionFormNamePattern, 'Fusion form name pattern is required')

        this._fusionIdentityDecisions = []
        this._fusionAssignmentDecisionMap = new Map()

        const forms = await this.fetchFormsByName(this.fusionFormNamePattern)
        this.log.debug(`Fetched ${forms.length} form definition(s) for pattern: ${this.fusionFormNamePattern}`)

        await Promise.all(
            forms.map(async (form) => {
                this.log.debug(`Fetching instances for form definition: ${form.id} (${form.name || 'unknown'})`)
                const instances = await this.fetchFormInstancesByDefinitionId(form.id)
                this.log.debug(`Fetched ${instances.length} instance(s) for form definition: ${form.id}`)

                this.processFusionFormInstances(instances)
            })
        )

        const fusionDecisionsCount = this._fusionIdentityDecisions?.length ?? 0
        this.log.debug(`Form data fetch completed - ${fusionDecisionsCount} fusion decision(s)`)
    }

    /**
     * Clean up completed and cancelled forms
     */
    public async cleanUpForms(): Promise<void> {
        if (this._formsToDelete.length === 0) {
            this.log.debug('No forms to clean up')
            return
        }

        this.log.info(`Cleaning up ${this._formsToDelete.length} form(s)`)
        await Promise.all(this._formsToDelete.map((formId) => this.deleteForm(formId)))
        this._formsToDelete = []
        this.log.debug('Form cleanup completed')
    }

    /**
     * Populate reviews for all reviewers from all form instances
     * This ensures reviewer accounts have all their assigned form instances in their reviews attribute
     */
    public async populateReviewerMap(reviewersBySourceId: Map<string, Set<FusionAccount>>): Promise<void> {
        this.log.debug('Populating reviews for all reviewers from form instances')
        assert(this.fusionFormNamePattern, 'Fusion form name pattern is required')

        const forms = await this.fetchFormsByName(this.fusionFormNamePattern)
        this.log.debug(`Found ${forms.length} form definition(s) for pattern: ${this.fusionFormNamePattern}`)

        // Build a map of reviewer identity IDs to reviewer accounts
        const reviewerMap = new Map<string, FusionAccount>()
        for (const reviewers of reviewersBySourceId.values()) {
            for (const reviewer of reviewers) {
                if (reviewer.identityId) {
                    reviewerMap.set(reviewer.identityId, reviewer)
                }
            }
        }

        if (reviewerMap.size === 0) {
            this.log.debug('No reviewers found, skipping review population')
            return
        }

        // Fetch all form instances for all forms
        let totalInstances = 0
        let reviewsAdded = 0

        await Promise.all(
            forms.map(async (form) => {
                const instances = await this.fetchFormInstancesByDefinitionId(form.id)
                totalInstances += instances.length

                for (const instance of instances) {
                    if (instance.recipients && instance.standAloneFormUrl) {
                        for (const recipient of instance.recipients) {
                            if (recipient.id) {
                                const reviewer = reviewerMap.get(recipient.id)
                                if (reviewer && instance.standAloneFormUrl) {
                                    reviewer.addFusionReview(instance.standAloneFormUrl)
                                    reviewsAdded++
                                }
                            }
                        }
                    }
                }
            })
        )

        this.log.debug(
            `Populated reviews for reviewers - processed ${totalInstances} form instance(s), added ${reviewsAdded} review(s)`
        )
    }

    /**
     * Create a fusion form for deduplication review
     */
    public async createFusionForm(
        fusionAccount: FusionAccount,
        reviewers: Set<FusionAccount> | undefined
    ): Promise<void> {
        assert(fusionAccount, 'Fusion account is required')

        if (!reviewers || reviewers.size === 0) {
            this.log.warn(`No reviewers found for account ${fusionAccount.name}, skipping form creation`)
            return
        }

        this.log.debug(`Building fusion form for account ${fusionAccount.name} with ${reviewers.size} reviewer(s)`)
        const candidates = this.buildCandidateList(fusionAccount)
        assert(candidates, 'Failed to build candidate list')

        const formName = this.buildFormName(fusionAccount)
        assert(formName, 'Form name is required')

        // Check if form definition already exists, if not create it
        let formDefinition = await this.findFormDefinitionByName(formName)
        if (!formDefinition) {
            this.log.debug(`Form definition not found, creating new one: ${formName}`)
            formDefinition = await this.buildFusionFormDefinition(formName, fusionAccount, candidates)
            assert(formDefinition, 'Failed to create form definition')
            assert(formDefinition.id, 'Form definition ID is required')
        } else {
            this.log.debug(`Using existing form definition: ${formDefinition.id}`)
        }

        const formInput = this.buildFormInput(fusionAccount, candidates)
        assert(formInput, 'Form input is required')

        const expire = this.calculateExpirationDate()
        assert(expire, 'Form expiration date is required')

        const { fusionSourceId } = this.sources
        assert(fusionSourceId, 'Fusion source ID is required')

        // Get existing form instances for this definition
        const existingInstances = await this.fetchFormInstancesByDefinitionId(formDefinition.id)
        const existingRecipientIds = new Set(
            existingInstances.flatMap((instance) => instance.recipients?.map((r) => r.id).filter(Boolean) || [])
        )

        // Add existing form instances to reviewers' reviews
        for (const instance of existingInstances) {
            if (instance.recipients && instance.standAloneFormUrl) {
                for (const recipient of instance.recipients) {
                    if (recipient.id) {
                        const reviewer = Array.from(reviewers).find((r) => r.identityId === recipient.id)
                        if (reviewer && instance.standAloneFormUrl) {
                            reviewer.addFusionReview(instance.standAloneFormUrl)
                            this.log.debug(
                                `Added existing form instance ${instance.id} to reviewer ${recipient.id} reviews`
                            )
                        }
                    }
                }
            }
        }

        // Create one form instance per reviewer
        for (const reviewer of reviewers) {
            let hasPreviousInstance = false
            const reviewerId = reviewer.identityId
            if (!reviewerId) {
                this.log.warn(`Reviewer ${reviewer.name} has no identity ID, skipping`)
                continue
            }

            // Check if form instance already exists for this reviewer
            if (existingRecipientIds.has(reviewerId)) {
                this.log.debug(`Form instance already exists for reviewer ${reviewerId}`)
                hasPreviousInstance = true
            }

            const formInstance = await this.createFormInstance(
                formDefinition.id!,
                formInput,
                [reviewerId],
                fusionSourceId,
                expire
            )
            assert(formInstance, 'Failed to create form instance')

            if (formInstance.id) {
                reviewer.addFusionReview(formInstance.standAloneFormUrl!)
                this.log.debug(`Created form instance ${formInstance.id} for reviewer ${reviewerId}`)

                if (this.messaging) {
                    if (hasPreviousInstance) {
                        this.log.debug(
                            `Previous instance existed for reviewer ${reviewerId}; still sending review email for new instance ${formInstance.id}`
                        )
                    }
                    try {
                        await this.messaging.sendFusionEmail(formInstance, {
                            accountName: fusionAccount.name || fusionAccount.displayName || 'Unknown',
                            accountSource: fusionAccount.sourceName,
                            accountId: fusionAccount.managedAccountId ?? fusionAccount.nativeIdentityOrUndefined,
                            accountEmail: fusionAccount.email,
                            accountAttributes: fusionAccount.attributes as any,
                            candidates: candidates.map((c) => ({
                                id: c.id,
                                name: c.name,
                                attributes: c.attributes,
                                scores: c.scores,
                            })),
                        })
                        this.log.debug(`Email notification sent for form ${formInstance.id}`)
                    } catch (error) {
                        this.log.warn(`Failed to send email notification for form ${formInstance.id}: ${error}`)
                    }
                }
            }
        }
    }

    /**
     * Get all fusion identity decisions
     */
    public getIdentityFusionDecisions(): FusionDecision[] {
        assert(this._fusionIdentityDecisions, 'Fusion identity decisions not fetched')
        return this._fusionIdentityDecisions
    }

    /**
     * Get fusion decision for a specific identity UID
     */
    public getIdentityFusionDecision(identityUid: string): FusionDecision | undefined {
        if (!this._fusionIdentityDecisions) {
            return undefined
        }
        return this._fusionIdentityDecisions.find((decision) => decision.account.id === identityUid)
    }

    /**
     * Get assignment fusion decision for an identity UID
     */
    public getAssignmentFusionDecision(identityUid: string): FusionDecision | undefined {
        assert(this._fusionAssignmentDecisionMap, 'Fusion duplicate decisions not fetched')
        return this._fusionAssignmentDecisionMap.get(identityUid)
    }

    /**
     * Fetch form instances by definition ID
     */
    public async fetchFormInstancesByDefinitionId(formDefinitionId?: string): Promise<FormInstanceResponseV2025[]> {
        const { customFormsApi } = this.client
        const axiosOptions: RawAxiosRequestConfig = {
            params: {
                filters: `formDefinitionId eq "${formDefinitionId}"`,
            },
        }

        const searchFormInstancesByTenant = async () => {
            const response = await customFormsApi.searchFormInstancesByTenant(axiosOptions)
            return response.data ?? []
        }

        const formInstances = await this.client.execute(searchFormInstancesByTenant)

        return formInstances
    }

    /**
     * Set form instance state
     */
    public async setFormInstanceState(
        formInstanceID: string,
        state: FormInstanceResponseV2025StateV2025
    ): Promise<FormInstanceResponseV2025> {
        const { customFormsApi } = this.client

        const body: { [key: string]: any }[] = [
            {
                op: 'replace',
                path: '/state',
                value: state,
            },
        ]

        const requestParameters: CustomFormsV2025ApiPatchFormInstanceRequest = {
            formInstanceID,
            body,
        }

        const patchFormInstanceState = async () => {
            const response = await customFormsApi.patchFormInstance(requestParameters)
            return response.data
        }

        const formInstance = await this.client.execute(patchFormInstanceState)
        return formInstance
    }

    // ------------------------------------------------------------------------
    // Private Helper Methods
    // ------------------------------------------------------------------------

    /**
     * Build candidate list from fusion matches
     */
    private buildCandidateList(fusionAccount: FusionAccount): Array<{
        id: string
        name: string
        attributes: Record<string, any>
        scores: any[]
    }> {
        assert(fusionAccount, 'Fusion account is required')
        assert(fusionAccount.fusionMatches, 'Fusion matches are required')

        const candidates = fusionAccount.fusionMatches.map((match) => {
            assert(match.fusionIdentity, 'Fusion identity is required in match')
            assert(match.fusionIdentity.identityId, 'Fusion identity ID is required')
            const attrs: Record<string, any> = match.fusionIdentity.attributes || {}
            return {
                id: match.fusionIdentity.identityId,
                // IMPORTANT: keep this aligned with the SELECT element's label path:
                // buildFormFields() uses SEARCH_V2 with label: 'attributes.displayName'
                name: String(
                    attrs.displayName || match.fusionIdentity.displayName || match.fusionIdentity.name || 'Unknown'
                ),
                attributes: attrs,
                scores: match.scores || [],
            }
        })

        this.log.debug(`Built candidate list with ${candidates.length} candidate(s)`)
        return candidates
    }

    /**
     * Build form name from fusion account
     */
    private buildFormName(fusionAccount: FusionAccount): string {
        const accountName = fusionAccount.name || fusionAccount.displayName || 'Unknown'
        return `${this.fusionFormNamePattern} - ${accountName} [${fusionAccount.sourceName}]`
    }

    /**
     * Build form input data structure
     */
    private buildFormInput(
        fusionAccount: FusionAccount,
        candidates: Array<{
            id: string
            name: string
            attributes: Record<string, any>
            scores: any[]
        }>
    ): { [key: string]: any } {
        const formInput: { [key: string]: any } = {}

        const accountIdentifier =
            String(fusionAccount.managedAccountId || '').trim() ||
            String(fusionAccount.nativeIdentityOrUndefined || '').trim() ||
            String((fusionAccount.attributes as any)?.id || '').trim() ||
            String((fusionAccount.attributes as any)?.uuid || '').trim() ||
            String(fusionAccount.identityId || '').trim() ||
            'unknown'

        // NOTE: formInput must match the form definition input types.
        // Keep values primitive (STRING/BOOLEAN/NUMBER) to avoid Custom Forms payload issues.
        formInput.name =
            fusionAccount.name ||
            fusionAccount.displayName ||
            fusionAccount.nativeIdentityOrUndefined ||
            accountIdentifier
        formInput.account = accountIdentifier
        formInput.source = fusionAccount.sourceName
        // Defaults for interactive decision fields
        // Keep as string to align with definition input type constraints.
        formInput.newIdentity = 'false'
        formInput.identities = ''

        // New identity attributes (flat keys for form elements)
        if (this.fusionFormAttributes && this.fusionFormAttributes.length > 0) {
            this.fusionFormAttributes.forEach((attrName) => {
                const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
                const attrValue = fusionAccount.attributes?.[attrName] || fusionAccount.attributes?.[attrKey] || ''
                formInput[`newidentity.${attrKey}`] = String(attrValue)
            })
        }

        // Candidate attributes and scores (flat keys for form elements)
        candidates.forEach((candidate) => {
            const candidateId = candidate.id

            if (this.fusionFormAttributes && this.fusionFormAttributes.length > 0) {
                this.fusionFormAttributes.forEach((attrName) => {
                    const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
                    const attrValue = candidate.attributes?.[attrName] || candidate.attributes?.[attrKey] || ''
                    formInput[`${candidateId}.${attrKey}`] = String(attrValue)
                })
            }

            // Add score inputs
            if (candidate.scores && candidate.scores.length > 0) {
                candidate.scores.forEach((score: any) => {
                    if (score.type && score.value !== undefined) {
                        formInput[`${candidateId}.${score.type}.score`] = String(score.value)
                        if (score.threshold !== undefined) {
                            formInput[`${candidateId}.${score.type}.threshold`] = String(score.threshold)
                        }
                    }
                })
            }
        })

        return formInput
    }

    /**
     * Calculate form expiration date
     */
    private calculateExpirationDate(): string {
        const expirationDate = new Date()
        expirationDate.setDate(expirationDate.getDate() + this.fusionFormExpirationDays)
        return expirationDate.toISOString()
    }

    /**
     * Fetch forms and their instances by name pattern, then process them
     */
    private async fetchFormDataByNamePattern(
        namePattern: string,
        processor: (formInstances: FormInstanceResponseV2025[]) => void
    ): Promise<void> {
        const forms = await this.fetchFormsByName(namePattern)
        const formInstancesMap = new Map<string, FormInstanceResponseV2025[]>()

        await Promise.all(
            forms.map(async (form) => {
                const instances = await this.fetchFormInstancesByDefinitionId(form.id)
                if (form.id) {
                    formInstancesMap.set(form.id, instances)
                }
            })
        )

        formInstancesMap.forEach(processor)
    }

    /**
     * Process fusion form instances and extract decisions
     */
    private processFusionFormInstances(formInstances: FormInstanceResponseV2025[]): void {
        assert(formInstances, 'Form instances array is required')

        let deleteForm = true
        let processedCount = 0
        let formDefinitionId: string | undefined = undefined
        let accountId: string | undefined = undefined

        instances: for (const instance of formInstances) {
            assert(instance, 'Form instance is required')
            assert(instance.state, 'Form instance state is required')

            if (!formDefinitionId) {
                formDefinitionId = instance.formDefinitionId
            }
            if (!accountId) {
                const formInputs = instance.formInput as FormDefinitionInputV2025 | undefined
                const accountInput = Object.values(formInputs ?? {}).find(
                    (x) => x && x.id === 'account' && (x.value?.length ?? 0) > 0
                )
                accountId = accountInput?.value
            }

            switch (instance.state) {
                case 'COMPLETED':
                    this.log.debug(`Processing completed form instance: ${instance.id}`)
                    this.addFusionDecision(instance)
                    deleteForm = true
                    processedCount++
                    break instances
                case 'CANCELLED':
                    this.log.info(`Form instance ${instance.id} was cancelled`)
                    processedCount++
                    break
                default:
                    deleteForm = false
                    this.log.debug(`Form instance ${instance.id} has state: ${instance.state}, not deleting form`)
                    break
            }
        }

        if (deleteForm && formDefinitionId) {
            this.addFormToDelete(formDefinitionId)
        } else if (accountId) {
            const managedAccountsMap = this.sources.managedAccountsById
            assert(managedAccountsMap, 'Managed accounts have not been loaded')
            managedAccountsMap.delete(accountId)
        }

        this.log.debug(`Processed ${processedCount} fusion form instance(s)`)
    }

    /**
     * Add fusion decision from completed form instance
     */
    private addFusionDecision(formInstance: FormInstanceResponseV2025): void {
        assert(formInstance, 'Form instance is required')
        assert(formInstance.id, 'Form instance ID is required')
        assert(this._fusionIdentityDecisions, 'Fusion identity decisions array is not initialized')

        const { formData, formInput, recipients } = formInstance

        if (!formData || !formInput || !recipients || recipients.length === 0) {
            this.log.warn(`Incomplete form instance data for fusion decision: ${formInstance.id}`)
            return
        }

        // Reconstruct account object if it's missing or flattened
        let account: any = formInput.account

        // If account is an object with value property, use it as is
        if (!account || typeof account !== 'object' || account.value === undefined) {
            // Account is missing, a string, or invalid - reconstruct from available data
            // Try to get account value from formInput.account (string) or formInput.name as fallback
            const accountValue =
                (typeof formInput.account === 'string' ? formInput.account : null) || formInput.name || ''
            if (!accountValue) {
                this.log.warn(`Missing account data in form instance: ${formInstance.id}`)
                return
            }
            account = {
                value: accountValue,
                displayName: formInput.name || accountValue,
                sourceName: formInput.source || '',
                attributes: this.reconstructAccountAttributes(formInput),
            }
        }

        const isNewIdentity = formData.newIdentity
        const existingIdentity = isNewIdentity ? undefined : formData.identities

        const reviewerIdentityId = recipients[0].id

        if (!reviewerIdentityId) {
            this.log.warn(`Missing reviewer identity ID in form instance: ${formInstance.id}`)
            return
        }

        const accountId: string = account?.value

        if (!accountId) {
            this.log.warn(`Missing account native identity in form instance: ${formInstance.id}`)
            return
        }

        const reviewer = this.getReviewerInfo(reviewerIdentityId)
        if (!reviewer) {
            this.log.warn(`Reviewer identity not found: ${reviewerIdentityId}`)
            return
        }

        const fusionDecision: FusionDecision = {
            submitter: reviewer,
            account: {
                id: accountId,
                name: account?.displayName || accountId,
                sourceName: account?.sourceName || '',
                attributes: account?.attributes || {},
            },
            newIdentity: isNewIdentity,
            identityId: existingIdentity,
            comments: formData.comments || '',
        }

        this._fusionIdentityDecisions.push(fusionDecision)

        this.log.debug(
            `Processed fusion decision for account ${accountId}, reviewer ${reviewerIdentityId}, ` +
                `decision: ${isNewIdentity ? 'new identity' : `link to ${existingIdentity}`}`
        )
    }

    /**
     * Reconstruct account attributes from flat form input keys
     */
    private reconstructAccountAttributes(formInput: { [key: string]: any }): Record<string, any> {
        const attributes: Record<string, any> = {}

        if (this.fusionFormAttributes && this.fusionFormAttributes.length > 0) {
            this.fusionFormAttributes.forEach((attrName) => {
                const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
                const attrValue = formInput[`newidentity.${attrKey}`]
                if (attrValue !== undefined && attrValue !== null && attrValue !== '') {
                    // Try to preserve original type if possible, otherwise use string
                    attributes[attrName] = attrValue
                    // Also set lowercase key for compatibility
                    attributes[attrKey] = attrValue
                }
            })
        }

        return attributes
    }

    /**
     * Get reviewer information from identity ID
     */
    private getReviewerInfo(identityId: string): { id: string; email: string; name: string } | undefined {
        if (!this.identities) {
            this.log.warn('IdentityService not available, cannot fetch reviewer info')
            return {
                id: identityId,
                email: '',
                name: '',
            }
        }

        const identity = this.identities.getIdentityById(identityId)
        if (!identity) {
            this.log.warn(`Identity not found for reviewer: ${identityId}`)
            return {
                id: identityId,
                email: '',
                name: identityId,
            }
        }

        return {
            id: identityId,
            email: identity.attributes?.email || '',
            name: identity.name || identity.attributes?.displayName || identityId,
        }
    }

    /**
     * Create a fusion form definition with appropriate fields
     */
    private async buildFusionFormDefinition(
        formName: string,
        fusionAccount: FusionAccount,
        candidates: Array<{
            id: string
            name: string
            attributes: Record<string, any>
            scores: any[]
        }>
    ): Promise<FormDefinitionResponseV2025> {
        const formFields = this.buildFormFields(fusionAccount, candidates)
        const formInputs = this.buildFormInputs(fusionAccount, candidates)
        const formConditions = this.buildFormConditions(fusionAccount, candidates)
        const owner = this.getFormOwner()

        const formDefinition: CustomFormsV2025ApiCreateFormDefinitionRequest = {
            body: {
                name: formName,
                description:
                    'Review potential duplicate identity and decide whether to create a new identity or link to an existing one',
                owner,
                formElements: formFields,
                formInput: formInputs,
                formConditions: formConditions as any,
            },
        }

        return await this.createForm(formDefinition)
    }

    /**
     * Build form fields for fusion form definition
     */
    private buildFormFields(
        fusionAccount: FusionAccount,
        candidates: Array<{
            id: string
            name: string
            attributes: Record<string, any>
            scores: any[]
        }>
    ): FormElementV2025[] {
        const formFields: FormElementV2025[] = []

        // Top section: Fusion review required header
        const topSectionElements: FormElementV2025[] = []
        if (this.fusionFormAttributes && this.fusionFormAttributes.length > 0) {
            this.fusionFormAttributes.forEach((attrName) => {
                const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
                const attrValue = fusionAccount.attributes?.[attrName] ?? fusionAccount.attributes?.[attrKey] ?? ''
                topSectionElements.push({
                    id: `newidentity.${attrKey}`,
                    key: `newidentity.${attrKey}`,
                    elementType: 'TEXT',
                    config: {
                        label: capitalizeFirst(attrName),
                        // Prefill visible values at definition-time so instances don't render blank.
                        default: String(attrValue),
                    },
                    validations: [],
                })
            })
        }

        if (topSectionElements.length > 0) {
            formFields.push({
                id: 'topSection',
                key: 'topSection',
                elementType: 'SECTION',
                config: {
                    alignment: 'CENTER',
                    description:
                        'A potential duplicate identity has been detected. Please review the candidate identities below and either select an existing identity to link this account to, or choose to create a new identity.',
                    formElements: topSectionElements,
                    label: `Fusion review required for ${fusionAccount.sourceName}`,
                    labelStyle: 'h2',
                    showLabel: true,
                },
                validations: [],
            })
        }

        // Build search query for identities: id:xxx OR id:yyy OR id:zzz
        const identityIds = candidates.map((candidate) => candidate.id)
        const identitySearchQuery = identityIds.map((id) => `id:${id}`).join(' OR ')

        // Fusion decision section: New identity toggle and identities select in a COLUMN_SET
        formFields.push({
            id: 'identitiesSection',
            key: 'identitiesSection',
            elementType: 'SECTION',
            config: {
                alignment: 'CENTER',
                formElements: [
                    {
                        id: 'decisionsColumnSet',
                        key: 'decisionsColumnSet',
                        elementType: 'COLUMN_SET',
                        config: {
                            alignment: 'CENTER',
                            columnCount: 2,
                            columns: [
                                [
                                    {
                                        id: 'newIdentity',
                                        key: 'newIdentity',
                                        elementType: 'TOGGLE',
                                        config: {
                                            label: 'New identity',
                                            default: false,
                                            trueLabel: 'True',
                                            falseLabel: 'False',
                                            helpText: 'Select this if the account is a new identity',
                                        },
                                        validations: [],
                                    },
                                ],
                                [
                                    {
                                        id: 'identities',
                                        key: 'identities',
                                        elementType: 'SELECT',
                                        config: {
                                            dataSource: {
                                                config: {
                                                    indices: ['identities'],
                                                    query: identitySearchQuery,
                                                    label: 'attributes.displayName',
                                                    sublabel: 'attributes.email',
                                                    value: 'id',
                                                },
                                                dataSourceType: 'SEARCH_V2',
                                            },
                                            forceSelect: true,
                                            label: 'Existing identity',
                                            maximum: 1,
                                            required: false,
                                            helpText: 'Select the identity the account is part of',
                                            placeholder: null,
                                        },
                                        validations: [],
                                    },
                                ],
                            ],
                            description: '',
                            label: 'Decisions',
                            labelStyle: 'h5',
                            showLabel: false,
                        },
                        validations: [],
                    },
                ],
                label: 'Fusion decision',
                labelStyle: 'h3',
                showLabel: true,
            },
            validations: [],
        })

        // Candidate sections: one per candidate
        candidates.forEach((candidate) => {
            const candidateId = candidate.id
            const candidateElements: FormElementV2025[] = []

            if (this.fusionFormAttributes && this.fusionFormAttributes.length > 0) {
                this.fusionFormAttributes.forEach((attrName) => {
                    const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
                    const attrValue = candidate.attributes?.[attrName] ?? candidate.attributes?.[attrKey] ?? ''
                    candidateElements.push({
                        id: `${candidateId}.${attrKey}`,
                        key: `${candidateId}.${attrKey}`,
                        elementType: 'TEXT',
                        config: {
                            label: capitalizeFirst(attrName),
                            default: String(attrValue),
                        },
                        validations: [],
                    })
                })
            }

            // Add score section if scores exist
            if (candidate.scores && candidate.scores.length > 0) {
                const scoreElements: FormElementV2025[] = []
                candidate.scores.forEach((score: any) => {
                    if (score.type && score.value !== undefined) {
                        scoreElements.push({
                            id: `${candidateId}.${score.type}.score`,
                            key: `${candidateId}.${score.type}.score`,
                            elementType: 'TEXT',
                            config: {
                                label: `${capitalizeFirst(score.type)} score`,
                                default: String(score.value),
                            },
                            validations: [],
                        })
                        if (score.threshold !== undefined) {
                            scoreElements.push({
                                id: `${candidateId}.${score.type}.threshold`,
                                key: `${candidateId}.${score.type}.threshold`,
                                elementType: 'TEXT',
                                config: {
                                    label: `${capitalizeFirst(score.type)} threshold`,
                                    default: String(score.threshold),
                                },
                                validations: [],
                            })
                        }
                    }
                })

                if (scoreElements.length > 0) {
                    // Group scores in a COLUMN_SET if we have multiple
                    if (scoreElements.length >= 2) {
                        const columns: FormElementV2025[][] = []
                        scoreElements.forEach((elem, index) => {
                            if (index % 2 === 0) {
                                columns.push([elem])
                            } else {
                                columns[columns.length - 1].push(elem)
                            }
                        })
                        candidateElements.push({
                            id: `${candidateId}.scoreSection`,
                            key: `${candidateId}.scoreSection`,
                            elementType: 'COLUMN_SET',
                            config: {
                                alignment: 'CENTER',
                                columnCount: 2,
                                columns: columns,
                                label: 'Score',
                                labelStyle: 'h5',
                                showLabel: true,
                            },
                            validations: [],
                        })
                    } else {
                        candidateElements.push(...scoreElements)
                    }
                }
            }

            // Add fusion score summary at the end (textarea, prefilled).
            // Using `default` ensures it renders; `description` alone may not show in the UI.
            if (candidate.scores && candidate.scores.length > 0) {
                // ScoreReport shape: { attribute, algorithm, fusionScore (threshold), mandatory, score, isMatch, comment? }
                // Be defensive and also accept older shapes (value/threshold/type) if present.
                const scoreValues = candidate.scores
                    .map((s: any) => Number(s?.score ?? s?.value))
                    .filter((n: any) => Number.isFinite(n)) as number[]
                const averageScore =
                    scoreValues.length > 0
                        ? (scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length).toFixed(1)
                        : 'N/A'

                const factorLines = candidate.scores
                    .filter((s: any) => s && (s.score !== undefined || s.value !== undefined))
                    .map((s: any) => {
                        const name = String(s.attribute ?? s.type ?? 'score')
                        const algorithmKey = String(s.algorithm ?? 'unknown')
                        const algorithm = FormService.ALGORITHM_LABELS[algorithmKey] ?? algorithmKey
                        const value = s.score !== undefined ? Number(s.score) : Number(s.value)
                        const thresholdRaw = s.fusionScore ?? s.threshold
                        const thresholdPart =
                            thresholdRaw !== undefined && thresholdRaw !== null
                                ? ` (threshold: ${String(thresholdRaw)}%)`
                                : ''
                        const matchPart =
                            s.isMatch !== undefined && s.isMatch !== null ? `, match: ${s.isMatch ? 'yes' : 'no'}` : ''
                        const commentPart = s.comment ? ` - ${String(s.comment)}` : ''
                        return `- ${name} [${algorithm}]: ${Number.isFinite(value) ? `${value}%` : String(s.score ?? s.value)}${thresholdPart}${matchPart}${commentPart}`
                    })

                const summary = [
                    `Average fusion score: ${averageScore}% (based on ${scoreValues.length} scoring factor(s))`,
                    factorLines.length > 0 ? '' : undefined,
                    factorLines.length > 0 ? 'Factors:' : undefined,
                    ...factorLines,
                ]
                    .filter((x): x is string => typeof x === 'string')
                    .join('\n')

                candidateElements.push({
                    id: `${candidateId}.scoreSummary`,
                    key: `${candidateId}.scoreSummary`,
                    // SailPoint forms support TEXTAREA element type; treated as free-form text input.
                    // We prefill it so it acts like a read-only summary in practice.
                    elementType: 'TEXTAREA' as any,
                    config: {
                        label: 'Fusion Score Summary',
                        default: summary,
                        rows: 10,
                        resize: true,
                    },
                    validations: [],
                })
            }

            if (candidateElements.length > 0) {
                formFields.push({
                    id: `${candidateId}.selectionsection`,
                    key: `${candidateId}.selectionsection`,
                    elementType: 'SECTION',
                    config: {
                        alignment: 'CENTER',
                        formElements: candidateElements,
                        label: `${candidate.name} details`,
                        labelStyle: 'h4',
                        showLabel: true,
                    },
                    validations: [],
                })
            }
        })

        return formFields
    }

    /**
     * Build form conditions to hide candidate sections when appropriate
     * and disable all TEXT fields at all times
     */
    private buildFormConditions(
        fusionAccount: FusionAccount,
        candidates: Array<{
            id: string
            name: string
            attributes: Record<string, any>
            scores: any[]
        }>
    ): any[] {
        const formConditions: any[] = []

        // Disable all TEXT fields in the top section (new identity attributes)
        // Use a condition that's always true by checking newIdentity against itself
        if (this.fusionFormAttributes && this.fusionFormAttributes.length > 0) {
            this.fusionFormAttributes.forEach((attrName) => {
                const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
                formConditions.push({
                    ruleOperator: 'AND',
                    rules: [
                        {
                            sourceType: 'ELEMENT',
                            source: 'newIdentity',
                            operator: 'NE',
                            valueType: 'STRING',
                            value: '__NEVER_MATCH__',
                        },
                    ],
                    effects: [
                        {
                            effectType: 'DISABLE',
                            config: {
                                element: `newidentity.${attrKey}`,
                            },
                        },
                    ],
                })
            })
        }

        // Disable all TEXT fields for candidate attributes and scores
        candidates.forEach((candidate) => {
            const candidateId = candidate.id

            // Disable candidate attribute fields
            // Use a condition that's always true by checking newIdentity against an impossible value
            if (this.fusionFormAttributes && this.fusionFormAttributes.length > 0) {
                this.fusionFormAttributes.forEach((attrName) => {
                    const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
                    formConditions.push({
                        ruleOperator: 'AND',
                        rules: [
                            {
                                sourceType: 'ELEMENT',
                                source: 'newIdentity',
                                operator: 'NE',
                                valueType: 'STRING',
                                value: '__NEVER_MATCH__',
                            },
                        ],
                        effects: [
                            {
                                effectType: 'DISABLE',
                                config: {
                                    element: `${candidateId}.${attrKey}`,
                                },
                            },
                        ],
                    })
                })
            }

            // Disable score fields
            // Use a condition that's always true by checking newIdentity against an impossible value
            if (candidate.scores && candidate.scores.length > 0) {
                candidate.scores.forEach((score: any) => {
                    if (score.type && score.value !== undefined) {
                        formConditions.push({
                            ruleOperator: 'AND',
                            rules: [
                                {
                                    sourceType: 'ELEMENT',
                                    source: 'newIdentity',
                                    operator: 'NE',
                                    valueType: 'STRING',
                                    value: '__NEVER_MATCH__',
                                },
                            ],
                            effects: [
                                {
                                    effectType: 'DISABLE',
                                    config: {
                                        element: `${candidateId}.${score.type}.score`,
                                    },
                                },
                            ],
                        })

                        if (score.threshold !== undefined) {
                            formConditions.push({
                                ruleOperator: 'AND',
                                rules: [
                                    {
                                        sourceType: 'ELEMENT',
                                        source: 'newIdentity',
                                        operator: 'NE',
                                        valueType: 'STRING',
                                        value: '__NEVER_MATCH__',
                                    },
                                ],
                                effects: [
                                    {
                                        effectType: 'DISABLE',
                                        config: {
                                            element: `${candidateId}.${score.type}.threshold`,
                                        },
                                    },
                                ],
                            })
                        }
                    }
                })

                // Disable scoreSummary TEXTAREA field
                // Use a condition that's always true by checking newIdentity against an impossible value
                formConditions.push({
                    ruleOperator: 'AND',
                    rules: [
                        {
                            sourceType: 'ELEMENT',
                            source: 'newIdentity',
                            operator: 'NE',
                            valueType: 'STRING',
                            value: '__NEVER_MATCH__',
                        },
                    ],
                    effects: [
                        {
                            effectType: 'DISABLE',
                            config: {
                                element: `${candidateId}.scoreSummary`,
                            },
                        },
                    ],
                })
            }
        })

        // For each candidate, create a condition that hides its section when:
        // - newIdentity is true, OR
        // - identities is not equal to the candidate's displayName (form condition evaluation uses displayName instead of ID)
        candidates.forEach((candidate) => {
            formConditions.push({
                ruleOperator: 'OR',
                rules: [
                    {
                        sourceType: 'ELEMENT',
                        source: 'newIdentity',
                        operator: 'EQ',
                        valueType: 'BOOLEAN',
                        value: 'true',
                    },
                    {
                        sourceType: 'ELEMENT',
                        source: 'identities',
                        operator: 'NE',
                        valueType: 'STRING',
                        value: candidate.name,
                    },
                ],
                effects: [
                    {
                        effectType: 'HIDE',
                        config: {
                            element: `${candidate.id}.selectionsection`,
                        },
                    },
                ],
            })
        })

        return formConditions
    }

    /**
     * Build form inputs for fusion form definition
     */
    private buildFormInputs(
        fusionAccount: FusionAccount,
        candidates: Array<{
            id: string
            name: string
            attributes: Record<string, any>
            scores: any[]
        }>
    ): FormDefinitionInputV2025[] {
        const formInputs: FormDefinitionInputV2025[] = []

        const accountIdentifier =
            String(fusionAccount.managedAccountId || '').trim() ||
            String(fusionAccount.nativeIdentityOrUndefined || '').trim() ||
            String((fusionAccount.attributes as any)?.id || '').trim() ||
            String((fusionAccount.attributes as any)?.uuid || '').trim() ||
            String(fusionAccount.identityId || '').trim() ||
            'unknown'

        // Account info
        formInputs.push({
            id: 'name',
            type: 'STRING',
            label: 'name',
            description:
                fusionAccount.name ||
                fusionAccount.displayName ||
                fusionAccount.nativeIdentityOrUndefined ||
                accountIdentifier,
        })
        formInputs.push({
            id: 'account',
            type: 'STRING',
            label: 'account',
            description: accountIdentifier,
        })
        formInputs.push({
            id: 'source',
            type: 'STRING',
            label: 'source',
            description: fusionAccount.sourceName,
        })

        // Decision inputs (bound to interactive elements)
        // NOTE: SDK only supports STRING / ARRAY for definition inputs. Toggle still binds to this key.
        formInputs.push({
            id: 'newIdentity',
            type: 'STRING',
            label: 'newIdentity',
            description: 'false',
        })
        formInputs.push({
            id: 'identities',
            type: 'STRING',
            label: 'identities',
            description: '',
        })

        // New identity attributes
        if (this.fusionFormAttributes && this.fusionFormAttributes.length > 0) {
            this.fusionFormAttributes.forEach((attrName) => {
                const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
                const attrValue = fusionAccount.attributes?.[attrName] || fusionAccount.attributes?.[attrKey] || ''
                formInputs.push({
                    id: `newidentity.${attrKey}`,
                    type: 'STRING',
                    label: `newidentity.${attrKey}`,
                    description: String(attrValue),
                })
            })
        }

        // Candidate attributes and scores
        candidates.forEach((candidate) => {
            const candidateId = candidate.id

            if (this.fusionFormAttributes && this.fusionFormAttributes.length > 0) {
                this.fusionFormAttributes.forEach((attrName) => {
                    const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
                    const attrValue = candidate.attributes?.[attrName] || candidate.attributes?.[attrKey] || ''
                    formInputs.push({
                        id: `${candidateId}.${attrKey}`,
                        type: 'STRING',
                        label: `${candidateId}.${attrKey}`,
                        description: String(attrValue),
                    })
                })
            }

            // Add score inputs
            if (candidate.scores && candidate.scores.length > 0) {
                candidate.scores.forEach((score: any) => {
                    if (score.type && score.value !== undefined) {
                        formInputs.push({
                            id: `${candidateId}.${score.type}.score`,
                            type: 'STRING',
                            label: `${candidateId}.${score.type}.score`,
                            description: String(score.value),
                        })
                        if (score.threshold !== undefined) {
                            formInputs.push({
                                id: `${candidateId}.${score.type}.threshold`,
                                type: 'STRING',
                                label: `${candidateId}.${score.type}.threshold`,
                                description: String(score.threshold),
                            })
                        }
                    }
                })
            }
        })

        return formInputs
    }

    /**
     * Get form owner from fusion source
     */
    private getFormOwner(): OwnerDto {
        const owner = this.sources.fusionSourceOwner
        assert(owner, 'Fusion source owner not found')

        return owner
    }

    /**
     * Add form to deletion queue
     */
    private addFormToDelete(formDefinitionId: string): void {
        // Avoid double-queueing the same definition id (processFusionFormInstances can hit multiple paths)
        if (!this._formsToDelete.includes(formDefinitionId)) {
            this._formsToDelete.push(formDefinitionId)
        }
    }

    // ------------------------------------------------------------------------
    // Form API Operations
    // ------------------------------------------------------------------------

    /**
     * Fetch forms by name pattern
     */
    private async fetchFormsByName(namePattern: string): Promise<FormDefinitionResponseV2025[]> {
        assert(namePattern, 'Form name pattern is required')
        assert(this.client, 'Client service is required')

        const { customFormsApi } = this.client
        assert(customFormsApi, 'Custom forms API is required')

        const requestParameters: CustomFormsV2025ApiSearchFormDefinitionsByTenantRequest = {
            filters: `name sw "${namePattern}"`,
        }

        this.log.debug(`Fetching forms with name pattern: ${namePattern}`)
        const searchFormDefinitionsByTenant = async (
            params: CustomFormsV2025ApiSearchFormDefinitionsByTenantRequest
        ) => {
            const response = await customFormsApi.searchFormDefinitionsByTenant(params)
            return {
                data: response.data?.results ?? [],
            }
        }

        const forms = await this.client.paginate(searchFormDefinitionsByTenant, requestParameters)
        this.log.debug(`Found ${forms.length} form(s) matching pattern: ${namePattern}`)
        return forms
    }

    /**
     * Find form definition by exact name
     */
    private async findFormDefinitionByName(formName: string): Promise<FormDefinitionResponseV2025 | undefined> {
        assert(formName, 'Form name is required')
        assert(this.client, 'Client service is required')

        const { customFormsApi } = this.client
        assert(customFormsApi, 'Custom forms API is required')

        const requestParameters: CustomFormsV2025ApiSearchFormDefinitionsByTenantRequest = {
            filters: `name eq "${formName}"`,
        }

        this.log.debug(`Searching for form definition with exact name: ${formName}`)
        const searchFormDefinitionsByTenant = async (
            params: CustomFormsV2025ApiSearchFormDefinitionsByTenantRequest
        ) => {
            const response = await customFormsApi.searchFormDefinitionsByTenant(params)
            return {
                data: response.data?.results ?? [],
            }
        }

        const forms = await this.client.paginate(searchFormDefinitionsByTenant, requestParameters)
        const form = forms.find((f) => f.name === formName)
        if (form) {
            this.log.debug(`Found existing form definition: ${form.id}`)
        } else {
            this.log.debug(`No form definition found with name: ${formName}`)
        }
        return form
    }

    /**
     * Create a form definition
     */
    private async createForm(
        form: CustomFormsV2025ApiCreateFormDefinitionRequest
    ): Promise<FormDefinitionResponseV2025> {
        assert(form, 'Form definition request is required')
        assert(form.body, 'Form definition body is required')
        assert(form.body.name, 'Form name is required')
        assert(this.client, 'Client service is required')

        const { customFormsApi } = this.client
        assert(customFormsApi, 'Custom forms API is required')

        this.log.debug(`Creating form definition: ${form.body.name}`)
        const createFormDefinition = async () => {
            const response = await customFormsApi.createFormDefinition(form)
            return response.data
        }
        const formInstance = await this.client.execute(createFormDefinition)
        assert(formInstance, 'Failed to create form definition')
        assert(formInstance.id, 'Form definition ID is missing')

        this.log.debug(`Form definition created successfully: ${formInstance.id}`)
        return formInstance
    }

    /**
     * Create a form instance
     */

    private async createFormInstance(
        formDefinitionId: string,
        formInput: { [key: string]: any },
        recipientList: string[],
        sourceId: string,
        expire: string
    ): Promise<FormInstanceResponseV2025> {
        assert(formDefinitionId, 'Form definition ID is required')
        assert(formInput, 'Form input is required')
        assert(recipientList, 'Recipient list is required')
        assert(recipientList.length > 0, 'At least one recipient is required')
        assert(sourceId, 'Source ID is required')
        assert(expire, 'Expiration date is required')
        assert(this.client, 'Client service is required')

        const { customFormsApi } = this.client
        assert(customFormsApi, 'Custom forms API is required')

        this.log.debug(
            `Creating form instance for definition ${formDefinitionId} with ${recipientList.length} recipient(s)`
        )
        const recipients: FormInstanceRecipientV2025[] = recipientList.map((x) => ({ id: x, type: 'IDENTITY' }))
        const createdBy: FormInstanceCreatedByV2025 = {
            id: sourceId,
            type: 'SOURCE',
        }

        const body: CreateFormInstanceRequestV2025 = {
            formDefinitionId,
            recipients,
            createdBy,
            expire,
            formInput,
            standAloneForm: true,
        }

        const requestParameters: CustomFormsV2025ApiCreateFormInstanceRequest = {
            body,
        }

        const createFormInstanceCall = async () => {
            const response = await customFormsApi.createFormInstance(requestParameters)
            return response.data
        }

        const response = await this.client.execute(createFormInstanceCall)
        assert(response, 'Failed to create form instance')
        this.log.debug(`Form instance created successfully: ${response.id || 'unknown'}`)
        return response
    }

    /**
     * Delete a form definition
     */
    private async deleteForm(formDefinitionID: string): Promise<void> {
        assert(formDefinitionID, 'Form definition ID is required')
        assert(this.client, 'Client service is required')

        const { customFormsApi } = this.client
        assert(customFormsApi, 'Custom forms API is required')

        this.log.debug(`Deleting form definition: ${formDefinitionID}`)
        const deleteFormDefinition = async () => {
            await customFormsApi.deleteFormDefinition({ formDefinitionID })
        }
        await this.client.execute(deleteFormDefinition)
        this.log.debug(`Form definition deleted successfully: ${formDefinitionID}`)
    }
}
