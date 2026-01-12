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
} from 'sailpoint-api-client'
import { RawAxiosRequestConfig } from 'axios'
import { FusionConfig } from '../model/config'
import { ClientService } from './clientService'
import { LogService } from './logService'
import { IdentityService } from './identityService'
import { MessagingService } from './messagingService'
import { assert } from '../utils/assert'
import { EditDecision, FusionDecision } from '../model/form'
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
    private _editDecisionMap?: Map<string, EditDecision>
    private readonly fusionFormNamePattern: string
    private readonly editFormNamePattern: string
    private readonly fusionFormExpirationDays: number
    private readonly fusionFormAttributes?: string[]
    private readonly newIdentityDecision: string
    private readonly managementWorkgroup: FusionConfig['managementWorkgroup']
    private readonly spConnectorInstanceId: string

    // ------------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------------

    constructor(
        config: FusionConfig,
        private log: LogService,
        private client: ClientService,
        private identities?: IdentityService,
        private messaging?: MessagingService
    ) {
        this.fusionFormNamePattern = config.fusionFormNamePattern
        this.editFormNamePattern = config.editFormNamePattern
        this.fusionFormExpirationDays = config.fusionFormExpirationDays
        this.fusionFormAttributes = config.fusionFormAttributes
        this.newIdentityDecision = config.newIdentityDecision
        this.managementWorkgroup = config.managementWorkgroup
        this.spConnectorInstanceId = config.spConnectorInstanceId
    }

    // ------------------------------------------------------------------------
    // Public Methods
    // ------------------------------------------------------------------------

    /**
     * Fetch and process form data from completed form instances
     */
    public async fetchFormData(): Promise<void> {
        this.log.debug('Fetching form data')
        this._fusionIdentityDecisions = []
        this._fusionAssignmentDecisionMap = new Map()
        this._editDecisionMap = new Map()

        await this.fetchFormDataByNamePattern(this.fusionFormNamePattern, (x) => this.processFusionFormInstances(x))
        await this.fetchFormDataByNamePattern(this.editFormNamePattern, (x) => this.processEditFormInstances(x))

        this.log.debug('Form data fetch completed')
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
        if (!reviewers || reviewers.size === 0) {
            this.log.warn(`No reviewers found for account ${fusionAccount.name}, skipping form creation`)
            return
        }

        const reviewerIds = Array.from(reviewers)
            .map((reviewer) => reviewer.identityId)
            .filter((id): id is string => !!id)

        if (reviewerIds.length === 0) {
            this.log.warn(`No valid reviewer identity IDs found for account ${fusionAccount.name}`)
            return
        }

        const candidates = this.buildCandidateList(fusionAccount)
        const formName = this.buildFormName(fusionAccount)
        const formDefinition = await this.createFusionFormDefinition(formName)

        if (!formDefinition.id) {
            throw new Error('Failed to create form definition: missing ID')
        }

        const formInput = this.buildFormInput(fusionAccount, candidates)
        const expire = this.calculateExpirationDate()

        const fusionSourceId = this.spConnectorInstanceId
        if (!fusionSourceId) {
            throw new Error('Fusion source ID not found in config')
        }

        const formInstance = await this.createFormInstance(
            formDefinition.id,
            formInput,
            reviewerIds,
            fusionSourceId,
            expire
        )

        if (formInstance.id) {
            fusionAccount.reviews.add(formInstance.id)
        }

        if (this.messaging && formInstance.id) {
            try {
                await this.messaging.sendFusionEmail(formInstance)
            } catch (error) {
                this.log.warn(`Failed to send email notification for form ${formInstance.id}: ${error}`)
            }
        }

        this.log.info(
            `Created fusion form ${formDefinition.id} for account ${fusionAccount.name} with ${reviewerIds.length} reviewer(s)`
        )
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
     * Get edit decision for an identity ID
     */
    public getEditDecision(identityId: string): EditDecision | undefined {
        assert(this._editDecisionMap, 'Edit decisions not fetched')
        return this._editDecisionMap.get(identityId)
    }

    /**
     * Fetch form instances by definition ID
     */
    public async fetchFormInstancesByDefinitionId(formDefinitionId?: string): Promise<FormInstanceResponseV2025[]> {
        const { formsApi } = this.client
        const axiosOptions: RawAxiosRequestConfig = {
            params: {
                filters: `formDefinitionId eq "${formDefinitionId}"`,
            },
        }

        const response = await this.client.execute(async () => {
            return await formsApi.searchFormInstancesByTenant(axiosOptions)
        })
        return response.data ?? []
    }

    /**
     * Set form instance state
     */
    public async setFormInstanceState(
        formInstanceID: string,
        state: FormInstanceResponseV2025StateV2025
    ): Promise<FormInstanceResponseV2025> {
        const { formsApi } = this.client

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
            const response = await formsApi.patchFormInstance(requestParameters)
            return response.data
        }

        const response = await this.client.execute(patchFormInstanceState)
        return response
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
        return fusionAccount.fusionMatches.map((match) => ({
            id: match.fusionIdentity.identityId,
            name: match.fusionIdentity.name || match.fusionIdentity.displayName || 'Unknown',
            attributes: match.fusionIdentity.attributes,
            scores: match.scores,
        }))
    }

    /**
     * Build form name from fusion account
     */
    private buildFormName(fusionAccount: FusionAccount): string {
        const accountName = fusionAccount.name || fusionAccount.displayName || 'Unknown'
        return `${this.fusionFormNamePattern} - ${accountName}`
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
        return {
            account: {
                value: fusionAccount.nativeIdentity,
                displayName: fusionAccount.name || fusionAccount.displayName || fusionAccount.nativeIdentity,
                attributes: fusionAccount.attributes,
                sourceName: fusionAccount.sourceName,
            },
            candidates: candidates.map((candidate) => ({
                value: candidate.id,
                displayName: candidate.name,
                attributes: candidate.attributes,
                scores: candidate.scores,
            })),
            identities: '',
            comments: '',
        }
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
        let deleteForm = true

        instances: for (const instance of formInstances) {
            switch (instance.state) {
                case 'COMPLETED':
                    this.addFusionDecision(instance)
                    this.addFormToDelete(instance.formDefinitionId!)
                    break instances
                case 'CANCELLED':
                    this.log.info(`Form instance ${instance.id} was cancelled.`)
                    break
                default:
                    deleteForm = false
                    break
            }
        }

        if (deleteForm && formInstances.length > 0) {
            this.addFormToDelete(formInstances[0].formDefinitionId!)
        }
    }

    /**
     * Process edit form instances and extract decisions
     */
    private processEditFormInstances(formInstances: FormInstanceResponseV2025[]): void {
        instances: for (const instance of formInstances) {
            switch (instance.state) {
                case 'COMPLETED':
                    const editDecision = this.addEditDecision([instance])
                    if (editDecision) {
                        const accountId = (instance.formInput?.account as any)?.value
                        if (accountId) {
                            this._editDecisionMap!.set(accountId, editDecision)
                        }
                    }
                    this.addFormToDelete(instance.formDefinitionId!)
                    break instances
                case 'CANCELLED':
                    this.log.info(`Form instance ${instance.id} was cancelled.`)
                    this.addFormToDelete(instance.formDefinitionId!)
                    break instances
                default:
                    break
            }
        }
    }

    /**
     * Add fusion decision from completed form instance
     */
    private addFusionDecision(formInstance: FormInstanceResponseV2025): void {
        const { formData, formInput, recipients } = formInstance

        if (!formData || !formInput || !recipients || recipients.length === 0) {
            this.log.warn(`Incomplete form instance data for fusion decision: ${formInstance.id}`)
            return
        }

        const account = formInput.account as any
        const decisionValue: string = formData.identities || ''
        const reviewerIdentityId = recipients[0].id

        if (!reviewerIdentityId) {
            this.log.warn(`Missing reviewer identity ID in form instance: ${formInstance.id}`)
            return
        }

        const accountNativeIdentity: string = account?.value

        if (!accountNativeIdentity) {
            this.log.warn(`Missing account native identity in form instance: ${formInstance.id}`)
            return
        }

        const reviewer = this.getReviewerInfo(reviewerIdentityId)
        if (!reviewer) {
            this.log.warn(`Reviewer identity not found: ${reviewerIdentityId}`)
            return
        }

        const isNewIdentity = decisionValue === this.newIdentityDecision || decisionValue === ''

        const fusionDecision: FusionDecision = {
            submitter: reviewer,
            account: {
                id: accountNativeIdentity,
                name: account?.displayName || accountNativeIdentity,
                sourceName: account?.sourceName || '',
                attributes: account?.attributes || {},
            },
            newIdentity: isNewIdentity,
            identityId: isNewIdentity ? undefined : decisionValue,
            comments: formData.comments || '',
        }

        this._fusionIdentityDecisions!.push(fusionDecision)

        this.log.debug(
            `Processed fusion decision for account ${accountNativeIdentity}, reviewer ${reviewerIdentityId}, ` +
                `decision: ${isNewIdentity ? 'new identity' : `link to ${decisionValue}`}`
        )
    }

    /**
     * Add edit decision from completed form instance
     */
    private addEditDecision(formInstances: FormInstanceResponseV2025[]): EditDecision | undefined {
        if (formInstances.length === 0) {
            return undefined
        }

        const formInstance = formInstances.find((inst) => inst.state === 'COMPLETED')
        if (!formInstance) {
            return undefined
        }

        const { formData, formInput, recipients } = formInstance

        if (!formData || !formInput || !recipients || recipients.length === 0) {
            this.log.warn(`Incomplete form instance data for edit decision: ${formInstance.id}`)
            return undefined
        }

        const account = formInput.account as any
        const reviewerIdentityId = recipients[0].id

        if (!reviewerIdentityId) {
            this.log.warn(`Missing reviewer identity ID in form instance: ${formInstance.id}`)
            return undefined
        }

        const reviewer = this.getReviewerInfo(reviewerIdentityId)
        if (!reviewer) {
            this.log.warn(`Reviewer identity not found: ${reviewerIdentityId}`)
            return undefined
        }

        const editDecision: EditDecision = {
            submitter: reviewer,
            account: {
                id: account?.value || '',
                name: account?.displayName || '',
                sourceName: account?.sourceName || '',
                attributes: formData || account?.attributes || {},
            },
            comments: formData.comments || '',
        }

        this.log.debug(`Processed edit decision for account ${account?.value || 'unknown'}`)
        return editDecision
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
    private async createFusionFormDefinition(formName: string): Promise<FormDefinitionResponseV2025> {
        const formFields = this.buildFormFields()
        const owner = this.getFormOwner()

        const formDefinition: CustomFormsV2025ApiCreateFormDefinitionRequest = {
            body: {
                name: formName,
                description:
                    'Review potential duplicate identity and decide whether to create a new identity or link to an existing one',
                owner,
                formElements: formFields,
            },
        }

        return await this.createForm(formDefinition)
    }

    /**
     * Build form fields for fusion form definition
     */
    private buildFormFields(): any[] {
        const formFields: any[] = [
            {
                key: 'account',
                title: 'Account',
                type: 'object',
                required: true,
            },
            {
                key: 'candidates',
                title: 'Potential Matches',
                type: 'array',
                required: false,
            },
            {
                key: 'identities',
                title: 'Decision',
                type: 'string',
                required: true,
                description: `Select "${this.newIdentityDecision}" to create a new identity, or select an existing identity to link this account`,
            },
            {
                key: 'comments',
                title: 'Comments',
                type: 'string',
                required: false,
            },
        ]

        if (this.fusionFormAttributes && this.fusionFormAttributes.length > 0) {
            this.fusionFormAttributes.forEach((attrName) => {
                formFields.push({
                    key: `attributes.${attrName}`,
                    title: attrName,
                    type: 'string',
                    required: false,
                    readOnly: true,
                })
            })
        }

        return formFields
    }

    /**
     * Get form owner from management workgroup
     */
    private getFormOwner(): { id: string; type: 'IDENTITY' } {
        const owner = this.managementWorkgroup
            ? {
                  id: this.managementWorkgroup.id!,
                  type: 'IDENTITY' as const,
              }
            : undefined

        if (!owner) {
            throw new Error('Form owner not found - management workgroup must be configured')
        }

        return owner
    }

    /**
     * Add form to deletion queue
     */
    private addFormToDelete(formDefinitionId: string): void {
        this._formsToDelete.push(formDefinitionId)
    }

    // ------------------------------------------------------------------------
    // Form API Operations
    // ------------------------------------------------------------------------

    /**
     * Fetch forms by name pattern
     */
    private async fetchFormsByName(namePattern: string): Promise<FormDefinitionResponseV2025[]> {
        const { formsApi } = this.client
        const requestParameters: CustomFormsV2025ApiSearchFormDefinitionsByTenantRequest = {
            filters: `name sw "${namePattern}"`,
        }

        const searchFormDefinitionsByTenant = async (
            params: CustomFormsV2025ApiSearchFormDefinitionsByTenantRequest
        ) => {
            const response = await formsApi.searchFormDefinitionsByTenant(params)
            return {
                data: response.data?.results ?? [],
            }
        }

        return await this.client.paginate(searchFormDefinitionsByTenant, requestParameters)
    }

    /**
     * Create a form definition
     */
    private async createForm(
        form: CustomFormsV2025ApiCreateFormDefinitionRequest
    ): Promise<FormDefinitionResponseV2025> {
        const { formsApi } = this.client
        const createFormDefinition = async () => {
            const response = await formsApi.createFormDefinition(form)
            return response.data
        }
        const response = await this.client.execute(createFormDefinition)
        return response
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
        const { formsApi } = this.client

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

        const createFormInstance = async () => {
            const response = await formsApi.createFormInstance(requestParameters)
            return response.data
        }

        const response = await this.client.execute(createFormInstance)
        return response
    }

    /**
     * Delete a form definition
     */
    private async deleteForm(formDefinitionID: string): Promise<void> {
        const { formsApi } = this.client
        const deleteFormDefinition = async () => {
            await formsApi.deleteFormDefinition({ formDefinitionID })
        }
        await this.client.execute(deleteFormDefinition)
    }
}
