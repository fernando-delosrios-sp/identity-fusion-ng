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
import { FusionConfig } from '../model/config'
import { ClientService } from './clientService'
import { LogService } from './logService'
import { RawAxiosRequestConfig } from 'axios'
import { assert } from '../utils/assert'
import { EditDecision, FusionDecision } from '../model/form'
import { FusionAccount } from '../model/account'

/**
 * Service for form definition and instance management.
 * TODO: Implement full form management functionality
 */
export class FormService {
    createFusionForm(_fusionAccount: FusionAccount, _reviewers: Set<FusionAccount> | undefined): void {
        this.log.warn('createFusionForm not fully implemented')
        throw new Error('Method not implemented.')
    }
    getIdentityFusionDecision(_identityId: string): unknown {
        this.log.warn('getIdentityFusionDecision not fully implemented')
        throw new Error('Method not implemented.')
    }
    private _formsToDelete: string[] = []
    private _fusionIdentityDecisions?: FusionDecision[]
    private _fusionAssignmentDecisionMap?: Map<string, FusionDecision>
    private _editDecisionMap?: Map<string, EditDecision>

    constructor(
        private config: FusionConfig,
        private log: LogService,
        private client: ClientService
    ) {}

    public getIdentityFusionDecisions() {
        assert(this._fusionIdentityDecisions, 'Fusion identity decisions not fetched')
        return this._fusionIdentityDecisions
    }

    public getAssignmentFusionDecision(identityUid: string) {
        assert(this._fusionAssignmentDecisionMap, 'Fusion duplicate decisions not fetched')
        return this._fusionAssignmentDecisionMap.get(identityUid)
    }

    public getEditDecision(identityId: string) {
        assert(this._editDecisionMap, 'Edit decisions not fetched')
        return this._editDecisionMap.get(identityId)
    }

    private addFormToDelete(formDefinitionId: string) {
        this._formsToDelete.push(formDefinitionId)
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

    public async fetchFormData(): Promise<void> {
        this.log.debug('Fetching form data')
        this._fusionIdentityDecisions = []
        this._fusionAssignmentDecisionMap = new Map()
        this._editDecisionMap = new Map()
        await this.fetchFormDataByNamePattern(this.config.fusionFormNamePattern, (x) =>
            this.processFusionFormInstances(x)
        )
        await this.fetchFormDataByNamePattern(this.config.editFormNamePattern, (x) => this.processEditFormInstances(x))
        this.log.debug('Form data fetch completed')
    }

    private addFusionDecision(formInstance: FormInstanceResponseV2025): void {
        const { formData, formInput, recipients } = formInstance

        if (!formData || !formInput || !recipients || recipients.length === 0) {
            this.log.warn(`Incomplete form instance data for fusion decision: ${formInstance.id}`)
            return
        }

        const account = formInput.account as any
        const decision: string = formData.identities
        const reviewerIdentityId = recipients[0].id
        const accountNativeIdentity: string = account?.value

        this.log.debug(
            `Processing fusion decision for account ${accountNativeIdentity}, reviewer ${reviewerIdentityId}, decision: ${decision}`
        )
        // TODO: Implement full fusion decision processing
    }

    private addEditDecision(formInstance: FormInstanceResponseV2025[]): EditDecision {
        this.log.debug(`Processing edit decision for ${formInstance.length} form instance(s)`)
        // TODO: Implement edit decision building
        return {} as EditDecision
    }

    private processFusionFormInstances(formInstances: FormInstanceResponseV2025[]) {
        let deleteForm = true
        instances: for (const instance of formInstances as FormInstanceResponseV2025[]) {
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

    private processEditFormInstances(formInstances: FormInstanceResponseV2025[]) {
        instances: for (const instance of formInstances) {
            switch (instance.state) {
                case 'COMPLETED':
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

    // -------------------------------------------------------------------------
    // Form API Operations (moved from ClientService)
    // -------------------------------------------------------------------------

    private async fetchFormsByName(namePattern: string): Promise<FormDefinitionResponseV2025[]> {
        const { formsApi } = this.client
        const requestParameters: CustomFormsV2025ApiSearchFormDefinitionsByTenantRequest = {
            filters: `name sw "${namePattern}"`,
        }

        // Transform the response to match paginate's expected format: { data: T[] }
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

    async fetchFormInstancesByDefinitionId(formDefinitionId?: string): Promise<FormInstanceResponseV2025[]> {
        const { formsApi } = this.client
        const axiosOptions: RawAxiosRequestConfig = {
            params: {
                filters: `formDefinitionId eq "${formDefinitionId}"`,
            },
        }
        // Note: searchFormInstancesByTenant doesn't support limit/offset pagination,
        // so we call it directly instead of using paginate
        const response = await this.client.execute(async () => {
            return await formsApi.searchFormInstancesByTenant(axiosOptions)
        })
        return response.data ?? []
    }

    async deleteForm(formDefinitionID: string): Promise<void> {
        const { formsApi } = this.client
        const deleteFormDefinition = async () => {
            await formsApi.deleteFormDefinition({ formDefinitionID })
        }
        await this.client.execute(deleteFormDefinition)
    }

    async createForm(form: CustomFormsV2025ApiCreateFormDefinitionRequest): Promise<FormDefinitionResponseV2025> {
        const { formsApi } = this.client
        const createFormDefinition = async () => {
            const response = await formsApi.createFormDefinition(form)
            return response.data
        }
        const response = await this.client.execute(createFormDefinition)
        return response
    }

    async createFormInstance(
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

    async setFormInstanceState(
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
}
