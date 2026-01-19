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
    private _formsToDelete: string[] = []
    private _fusionIdentityDecisions?: FusionDecision[]
    private _fusionAssignmentDecisionMap?: Map<string, FusionDecision>
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
        const candidates = buildCandidateList(fusionAccount)
        assert(candidates, 'Failed to build candidate list')

        const formName = buildFormName(fusionAccount, this.fusionFormNamePattern)
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

        const formInput = buildFormInput(fusionAccount, candidates, this.fusionFormAttributes)
        assert(formInput, 'Form input is required')

        const expire = calculateExpirationDate(this.fusionFormExpirationDays)
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

            const reviewPromise = (async (): Promise<string | undefined> => {
                const formInstance = await this.createFormInstance(
                    formDefinition.id!,
                    formInput,
                    [reviewerId],
                    fusionSourceId,
                    expire
                )
                assert(formInstance, 'Failed to create form instance')

                if (formInstance.id) {
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

                    return formInstance.standAloneFormUrl ?? undefined
                }

                return undefined
            })()

            reviewer.addReviewPromise(reviewPromise)
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
     * Get assignment fusion decision for an identity ID
     */
    public getAssignmentFusionDecision(identityId: string): FusionDecision | undefined {
        assert(this._fusionAssignmentDecisionMap, 'Fusion duplicate decisions not fetched')
        return this._fusionAssignmentDecisionMap.get(identityId)
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
        assert(this._fusionIdentityDecisions, 'Fusion identity decisions array is not initialized')
        assert(this._fusionAssignmentDecisionMap, 'Fusion assignment decision map is not initialized')
        assert(formInstances, 'Form instances array is required')

        let shouldDeleteForm = true
        let processedCount = 0
        let formDefinitionId: string | undefined = undefined
        let accountId: string | undefined = undefined
        const instancesToProcess: FormInstanceResponseV2025[] = []

        // First pass: determine which instances to process and get account ID
        instances: for (const instance of formInstances) {
            assert(instance, 'Form instance is required')
            assert(instance.state, 'Form instance state is required')

            if (!formDefinitionId) {
                formDefinitionId = instance.formDefinitionId
            }
            if (!accountId) {
                // Try flat structure first (as sent in createFormInstance)
                if (typeof instance.formInput === 'object' && instance.formInput !== null) {
                    const formInput = instance.formInput as any
                    if (typeof formInput.account === 'string') {
                        accountId = formInput.account
                    } else {
                        // Try dictionary structure (formInput is an object with input objects)
                        const formInputs = formInput as Record<string, any> | undefined
                        const accountInput = formInputs ? Object.values(formInputs).find(
                            (x: any) => x?.id === 'account' && (x.value || x.description)
                        ) : undefined
                        accountId = accountInput?.value || accountInput?.description
                    }
                }
            }

            switch (instance.state) {
                case 'COMPLETED':
                    this.log.debug(`Processing completed form instance: ${instance.id}`)
                    instancesToProcess.push(instance)
                    shouldDeleteForm = true
                    processedCount++
                    break instances
                case 'IN_PROGRESS':
                    this.log.debug(`Processing completed form instance: ${instance.id}`)
                    instancesToProcess.push(instance)
                    shouldDeleteForm = true
                    processedCount++
                    break instances
                case 'CANCELLED':
                    this.log.info(`Form instance ${instance.id} was cancelled`)
                    processedCount++
                    break
                default:
                    // Pending / in-progress instance: capture as an unfinished decision so
                    // we can populate reviewer context (reviews) without affecting fusion.
                    instancesToProcess.push(instance)
                    shouldDeleteForm = false
                    this.log.debug(`Form instance ${instance.id} has state: ${instance.state}, not deleting form`)
                    break
            }
        }

        // Extract account info from managedAccountsById before deleting it
        let accountInfoOverride: { id: string; name: string; sourceName: string } | undefined
        if (accountId) {
            const managedAccountsMap = this.sources.managedAccountsById
            assert(managedAccountsMap, 'Managed accounts have not been loaded')
            const account = managedAccountsMap.get(accountId)
            if (account) {
                accountInfoOverride = {
                    id: accountId,
                    name: account.name || accountId,
                    sourceName: account.sourceName || '',
                }
                // Delete after extracting info
                managedAccountsMap.delete(accountId)
            }
        }

        // Second pass: create decisions with account info from managedAccountsById
        let decisionsAdded = 0
        for (const instance of instancesToProcess) {
            const decision = createFusionDecision(instance, this.identities, accountInfoOverride)
            if (decision) {
                this._fusionIdentityDecisions.push(decision)

                // Populate assignment decision map keyed by identityId (the identity the account is assigned to)
                if (decision.identityId && decision.finished) {
                    this._fusionAssignmentDecisionMap.set(decision.identityId, decision)
                }

                decisionsAdded++
                this.log.debug(
                    `Processed fusion decision for account ${decision.account.id}, reviewer ${decision.submitter.id}, ` +
                        `decision: ${decision.newIdentity ? 'new identity' : `link to ${decision.identityId}`}`
                )
            } else {
                this.log.warn(`Failed to create fusion decision for form instance: ${instance.id}`)
            }
        }

        if (decisionsAdded > 0) {
            this.log.debug(`Added ${decisionsAdded} fusion decision(s) from ${processedCount} processed instance(s)`)
        }

        // Mark form for deletion if needed
        if (shouldDeleteForm && formDefinitionId) {
            this.addFormToDelete(formDefinitionId)
        }
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
