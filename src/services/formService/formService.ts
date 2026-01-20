import {
    FormDefinitionResponseV2025,
    FormInstanceResponseV2025,
    FormInstanceResponseV2025StateV2025,
    CreateFormInstanceRequestV2025,
    FormInstanceCreatedByV2025,
    FormInstanceRecipientV2025,
    CustomFormsV2025ApiSearchFormDefinitionsByTenantRequest,
    CustomFormsV2025ApiCreateFormDefinitionRequest,
    CustomFormsV2025ApiCreateFormInstanceRequest,
    CustomFormsV2025ApiPatchFormInstanceRequest,
} from 'sailpoint-api-client'
import { RawAxiosRequestConfig } from 'axios'
import { FusionConfig } from '../../model/config'
import { ClientService } from '../clientService'
import { LogService } from '../logService'
import { IdentityService } from '../identityService'
import { MessagingService } from '../messagingService'
import { SourceService } from '../sourceService'
import { assert } from '../../utils/assert'
import { FusionDecision } from '../../model/form'
import { FusionAccount } from '../../model/account'
import { Candidate } from './types'
import { buildCandidateList, buildFormName, calculateExpirationDate, getFormOwner } from './helpers'
import { buildFormInput, buildFormFields, buildFormConditions, buildFormInputs } from './formBuilder'
import { createFusionDecision } from './formProcessor'

// ============================================================================
// FormService Class
// ============================================================================

/**
 * Service for form definition and instance management.
 * Handles creation, processing, and cleanup of fusion forms for deduplication review.
 */
export class FormService {
    private formsToDelete: string[] = []
    private fusionIdentityDecisions?: FusionDecision[]
    private fusionAssignmentDecisionMap: Map<string, FusionDecision> = new Map()
    private readonly fusionFormNamePattern: string
    private readonly fusionFormExpirationDays: number
    private readonly fusionFormAttributes?: string[]

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

        this.fusionIdentityDecisions = []
        this.fusionAssignmentDecisionMap = new Map()

        const forms = await this.fetchFormsByName(this.fusionFormNamePattern)
        this.log.debug(`Fetched ${forms.length} form definition(s) for pattern: ${this.fusionFormNamePattern}`)

        // Fetch all instances in parallel for better performance
        const formInstancesResults = await Promise.all(
            forms.map(async (form) => {
                this.log.debug(`Fetching instances for form definition: ${form.id} (${form.name || 'unknown'})`)
                const instances = await this.fetchFormInstancesByDefinitionId(form.id)
                this.log.debug(`Fetched ${instances.length} instance(s) for form definition: ${form.id}`)
                return instances
            })
        )

        // Process all instances sequentially to avoid race conditions when modifying shared state
        // (fetching was done in parallel above, processing is fast so sequential is fine)
        for (const instances of formInstancesResults) {
            if (instances.length > 0) {
                this.processFusionFormInstances(instances)
            }
        }

        const fusionDecisionsCount = this.fusionIdentityDecisions?.length ?? 0
        this.log.debug(`Form data fetch completed - ${fusionDecisionsCount} fusion decision(s)`)
    }

    public async deleteExistingForms(): Promise<void> {
        const forms = await this.fetchFormsByName(this.fusionFormNamePattern)
        await Promise.all(forms.map((form) => this.deleteForm(form.id!)))
    }

    /**
     * Clean up completed and cancelled forms
     */
    public async cleanUpForms(): Promise<void> {
        if (this.formsToDelete.length === 0) {
            this.log.debug('No forms to clean up')
            return
        }

        this.log.info(`Cleaning up ${this.formsToDelete.length} form(s)`)
        await Promise.all(this.formsToDelete.map((formId) => this.deleteForm(formId)))
        this.formsToDelete = []
        this.log.debug('Form cleanup completed')
    }

    /**
     * Create a fusion form for deduplication review
     */
    public async createFusionForm(
        fusionAccount: FusionAccount,
        reviewers: Set<FusionAccount> | undefined
    ): Promise<void> {
        assert(fusionAccount, 'Fusion account is required')

        if (!this.hasValidReviewers(reviewers, fusionAccount.name || 'Unknown')) {
            return
        }

        const { candidates, formDefinition, formInput, expire, fusionSourceId } =
            await this.prepareFormCreationData(fusionAccount, reviewers!.size)

        const existingInstances = await this.fetchFormInstancesByDefinitionId(formDefinition.id)
        const existingRecipientIds = this.extractExistingRecipientIds(existingInstances)

        this.associateExistingInstancesWithReviewers(existingInstances, reviewers!)

        await this.createFormInstancesForReviewers(
            reviewers!,
            formDefinition,
            formInput,
            fusionSourceId,
            expire,
            fusionAccount,
            candidates,
            existingRecipientIds
        )
    }

    /**
     * Validate that reviewers exist and are not empty
     */
    private hasValidReviewers(reviewers: Set<FusionAccount> | undefined, accountName: string): boolean {
        if (!reviewers || reviewers.size === 0) {
            this.log.warn(`No reviewers found for account ${accountName}, skipping form creation`)
            return false
        }
        return true
    }

    /**
     * Prepare all data needed for form creation
     */
    private async prepareFormCreationData(
        fusionAccount: FusionAccount,
        reviewerCount: number
    ): Promise<{
        candidates: Candidate[]
        formName: string
        formDefinition: FormDefinitionResponseV2025
        formInput: { [key: string]: any }
        expire: string
        fusionSourceId: string
    }> {
        this.log.debug(`Building fusion form for account ${fusionAccount.name} with ${reviewerCount} reviewer(s)`)

        const candidates = buildCandidateList(fusionAccount)
        assert(candidates, 'Failed to build candidate list')

        const formName = buildFormName(fusionAccount, this.fusionFormNamePattern)
        assert(formName, 'Form name is required')

        const formDefinition = await this.getOrCreateFormDefinition(formName, fusionAccount, candidates)

        const formInput = buildFormInput(fusionAccount, candidates, this.fusionFormAttributes)
        assert(formInput, 'Form input is required')

        const expire = calculateExpirationDate(this.fusionFormExpirationDays)
        assert(expire, 'Form expiration date is required')

        const { fusionSourceId } = this.sources
        assert(fusionSourceId, 'Fusion source ID is required')

        return { candidates, formName, formDefinition, formInput, expire, fusionSourceId }
    }

    /**
     * Get existing form definition or create a new one
     */
    private async getOrCreateFormDefinition(
        formName: string,
        fusionAccount: FusionAccount,
        candidates: Candidate[]
    ): Promise<FormDefinitionResponseV2025> {
        let formDefinition = await this.findFormDefinitionByName(formName)
        if (!formDefinition) {
            this.log.debug(`Form definition not found, creating new one: ${formName}`)
            formDefinition = await this.buildFusionFormDefinition(formName, fusionAccount, candidates)
            assert(formDefinition, 'Failed to create form definition')
            assert(formDefinition.id, 'Form definition ID is required')
        } else {
            this.log.debug(`Using existing form definition: ${formDefinition.id}`)
        }
        return formDefinition
    }

    /**
     * Extract recipient IDs from existing form instances
     */
    private extractExistingRecipientIds(instances: FormInstanceResponseV2025[]): Set<string> {
        const recipientIds: string[] = []
        for (const instance of instances) {
            if (instance.recipients) {
                for (const recipient of instance.recipients) {
                    if (recipient.id) {
                        recipientIds.push(recipient.id)
                    }
                }
            }
        }
        return new Set(recipientIds)
    }

    /**
     * Associate existing form instances with their reviewers
     */
    private associateExistingInstancesWithReviewers(
        existingInstances: FormInstanceResponseV2025[],
        reviewers: Set<FusionAccount>
    ): void {
        for (const instance of existingInstances) {
            if (!instance.recipients || !instance.standAloneFormUrl) {
                continue
            }

            for (const recipient of instance.recipients) {
                if (!recipient.id) {
                    continue
                }

                const reviewer = Array.from(reviewers).find((r) => r.identityId === recipient.id)
                if (reviewer) {
                    reviewer.addFusionReview(instance.standAloneFormUrl)
                    this.log.debug(
                        `Added existing form instance ${instance.id} to reviewer ${recipient.id} reviews`
                    )
                }
            }
        }
    }

    /**
     * Create form instances for each reviewer
     */
    private async createFormInstancesForReviewers(
        reviewers: Set<FusionAccount>,
        formDefinition: FormDefinitionResponseV2025,
        formInput: { [key: string]: any },
        fusionSourceId: string,
        expire: string,
        fusionAccount: FusionAccount,
        candidates: Candidate[],
        existingRecipientIds: Set<string>
    ): Promise<void> {
        for (const reviewer of reviewers) {
            const reviewerId = reviewer.identityId
            if (!reviewerId) {
                this.log.warn(`Reviewer ${reviewer.name} has no identity ID, skipping`)
                continue
            }

            const hasPreviousInstance = existingRecipientIds.has(reviewerId)
            if (hasPreviousInstance) {
                this.log.debug(`Form instance already exists for reviewer ${reviewerId}`)
            }

            const reviewPromise = this.createReviewPromise(
                formDefinition.id!,
                formInput,
                reviewerId,
                fusionSourceId,
                expire,
                fusionAccount,
                candidates,
                hasPreviousInstance
            )

            reviewer.addReviewPromise(reviewPromise)
        }
    }

    /**
     * Create a promise that handles form instance creation and email notification
     */
    private createReviewPromise(
        formDefinitionId: string,
        formInput: { [key: string]: any },
        reviewerId: string,
        fusionSourceId: string,
        expire: string,
        fusionAccount: FusionAccount,
        candidates: Candidate[],
        hasPreviousInstance: boolean
    ): Promise<string | undefined> {
        return (async (): Promise<string | undefined> => {
            const formInstance = await this.createFormInstance(
                formDefinitionId,
                formInput,
                [reviewerId],
                fusionSourceId,
                expire
            )
            assert(formInstance, 'Failed to create form instance')

            if (!formInstance.id) {
                return undefined
            }

            this.log.debug(`Created form instance ${formInstance.id} for reviewer ${reviewerId}`)

            await this.sendFormInstanceNotificationIfEnabled(
                formInstance,
                fusionAccount,
                candidates,
                reviewerId,
                hasPreviousInstance
            )

            return formInstance.standAloneFormUrl ?? undefined
        })()
    }

    /**
     * Send email notification for form instance if messaging is enabled
     */
    private async sendFormInstanceNotificationIfEnabled(
        formInstance: FormInstanceResponseV2025,
        fusionAccount: FusionAccount,
        candidates: Candidate[],
        reviewerId: string,
        hasPreviousInstance: boolean
    ): Promise<void> {
        if (!this.messaging) {
            return
        }

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

    /**
     * Get all fusion identity decisions
     */
    public getIdentityFusionDecisions(): FusionDecision[] {
        assert(this.fusionIdentityDecisions, 'Fusion identity decisions not fetched')
        return this.fusionIdentityDecisions
    }

    /**
     * Get fusion decision for a specific identity UID
     */
    public getIdentityFusionDecision(identityUid: string): FusionDecision | undefined {
        if (!this.fusionIdentityDecisions) {
            return undefined
        }
        return this.fusionIdentityDecisions.find((decision) => decision.account.id === identityUid)
    }

    /**
     * Get assignment fusion decision for an identity ID
     */
    public getAssignmentFusionDecision(identityId: string): FusionDecision | undefined {
        return this.fusionAssignmentDecisionMap.get(identityId)
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
     * Process fusion form instances and extract decisions
     */
    private processFusionFormInstances(formInstances: FormInstanceResponseV2025[]): void {
        assert(this.fusionIdentityDecisions, 'Fusion identity decisions array is not initialized')
        assert(this.fusionAssignmentDecisionMap, 'Fusion assignment decision map is not initialized')
        assert(formInstances, 'Form instances array is required')

        const processingResult = this.analyzeFormInstances(formInstances)
        const accountInfoOverride = this.extractAccountInfoOverride(processingResult.accountId, processingResult.shouldDeleteForm)

        const decisionsAdded = this.createDecisionsFromInstances(
            processingResult.instancesToProcess,
            accountInfoOverride
        )

        if (processingResult.shouldDeleteForm && processingResult.formDefinitionId) {
            this.addFormToDelete(processingResult.formDefinitionId)
        }

        if (decisionsAdded > 0) {
            this.log.debug(
                `Added ${decisionsAdded} fusion decision(s) from ${processingResult.processedCount} processed instance(s)`
            )
        }
    }

    /**
     * Analyze form instances to determine which to process and extract metadata
     */
    private analyzeFormInstances(formInstances: FormInstanceResponseV2025[]): {
        instancesToProcess: FormInstanceResponseV2025[]
        shouldDeleteForm: boolean
        formDefinitionId: string | undefined
        accountId: string | undefined
        processedCount: number
    } {
        let shouldDeleteForm = true
        let processedCount = 0
        let formDefinitionId: string | undefined = undefined
        let accountId: string | undefined = undefined
        const instancesToProcess: FormInstanceResponseV2025[] = []

        for (const instance of formInstances) {
            assert(instance, 'Form instance is required')
            assert(instance.state, 'Form instance state is required')

            formDefinitionId = formDefinitionId || instance.formDefinitionId
            accountId = accountId || this.extractAccountIdFromInstance(instance)

            const stateResult = this.processInstanceState(instance, instancesToProcess)
            shouldDeleteForm = stateResult.shouldDeleteForm
            processedCount += stateResult.processedCount

            if (stateResult.shouldBreakLoop) {
                break
            }
        }

        return {
            instancesToProcess,
            shouldDeleteForm,
            formDefinitionId,
            accountId,
            processedCount,
        }
    }

    /**
     * Extract account ID from form instance input
     */
    private extractAccountIdFromInstance(instance: FormInstanceResponseV2025): string | undefined {
        if (typeof instance.formInput !== 'object' || instance.formInput === null) {
            return undefined
        }

        const formInput = instance.formInput as any

        // Try flat structure first (as sent in createFormInstance)
        if (typeof formInput.account === 'string') {
            return formInput.account
        }

        // Try dictionary structure (formInput is an object with input objects)
        const formInputs = formInput as Record<string, any> | undefined
        const accountInput = formInputs
            ? Object.values(formInputs).find((x: any) => x?.id === 'account' && (x.value || x.description))
            : undefined

        return accountInput?.value || accountInput?.description
    }

    /**
     * Process instance state and determine if it should be included
     */
    private processInstanceState(
        instance: FormInstanceResponseV2025,
        instancesToProcess: FormInstanceResponseV2025[]
    ): { shouldDeleteForm: boolean; processedCount: number; shouldBreakLoop: boolean } {
        switch (instance.state) {
            case 'COMPLETED':
            case 'IN_PROGRESS':
                this.log.debug(`Processing completed form instance: ${instance.id}`)
                instancesToProcess.push(instance)
                return { shouldDeleteForm: true, processedCount: 1, shouldBreakLoop: true }

            case 'CANCELLED':
                this.log.info(`Form instance ${instance.id} was cancelled`)
                return { shouldDeleteForm: true, processedCount: 1, shouldBreakLoop: false }

            default:
                // Pending / in-progress instance: capture as an unfinished decision so
                // we can populate reviewer context (reviews) without affecting fusion.
                instancesToProcess.push(instance)
                this.log.debug(`Form instance ${instance.id} has state: ${instance.state}, not deleting form`)
                return { shouldDeleteForm: false, processedCount: 0, shouldBreakLoop: false }
        }
    }

    /**
     * Extract account info override from managed accounts before deletion
     */
    private extractAccountInfoOverride(
        accountId: string | undefined, keepAccount: boolean
    ): { id: string; name: string; sourceName: string } | undefined {
        if (!accountId) {
            return undefined
        }

        const managedAccountsMap = this.sources.managedAccountsById
        assert(managedAccountsMap, 'Managed accounts have not been loaded')

        const account = managedAccountsMap.get(accountId)
        if (!account) {
            return undefined
        }

        // Delete after extracting info
        if (!keepAccount) {
            managedAccountsMap.delete(accountId)
        }

        return {
            id: accountId,
            name: account.name || accountId,
            sourceName: account.sourceName || '',
        }
    }

    /**
     * Create fusion decisions from processed instances
     * @returns The number of decisions successfully created
     */
    private createDecisionsFromInstances(
        instancesToProcess: FormInstanceResponseV2025[],
        accountInfoOverride: { id: string; name: string; sourceName: string } | undefined
    ): number {
        let decisionsAdded = 0

        for (const instance of instancesToProcess) {
            const decision = createFusionDecision(instance, this.identities, accountInfoOverride)
            if (!decision) {
                this.log.warn(`Failed to create fusion decision for form instance: ${instance.id}`)
                continue
            }

            this.fusionIdentityDecisions!.push(decision)

            // Populate assignment decision map keyed by identityId (the identity the account is assigned to)
            if (decision.identityId && decision.finished) {
                this.fusionAssignmentDecisionMap!.set(decision.identityId, decision)
            }

            decisionsAdded++
            this.logFusionDecision(decision)
        }

        return decisionsAdded
    }

    /**
     * Log fusion decision details
     */
    private logFusionDecision(decision: FusionDecision): void {
        const decisionType = decision.newIdentity ? 'new identity' : `link to ${decision.identityId}`
        this.log.debug(
            `Processed fusion decision for account ${decision.account.id}, reviewer ${decision.submitter.id}, ` +
            `decision: ${decisionType}`
        )
    }

    /**
     * Create a fusion form definition with appropriate fields
     */
    private async buildFusionFormDefinition(
        formName: string,
        fusionAccount: FusionAccount,
        candidates: Candidate[]
    ): Promise<FormDefinitionResponseV2025> {
        const formFields = buildFormFields(fusionAccount, candidates, this.fusionFormAttributes)
        const formInputs = buildFormInputs(fusionAccount, candidates, this.fusionFormAttributes)
        const formConditions = buildFormConditions(candidates, this.fusionFormAttributes)
        const owner = getFormOwner(this.sources)

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
     * Add form to deletion queue
     */
    private addFormToDelete(formDefinitionId: string): void {
        // Avoid double-queueing the same definition id (processFusionFormInstances can hit multiple paths)
        if (!this.formsToDelete.includes(formDefinitionId)) {
            this.formsToDelete.push(formDefinitionId)
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
