import {
    FormInstanceResponseV2025,
    WorkflowV2025,
    TestWorkflowRequestV2025,
    WorkflowsV2025ApiTestWorkflowRequest,
    CreateWorkflowRequestV2025,
} from 'sailpoint-api-client'
import type { TemplateDelegate as HandlebarsTemplateDelegate } from 'handlebars'
import { FusionConfig } from '../../model/config'
import { ClientService } from '../clientService'
import { LogService } from '../logService'
import { EmailWorkflow } from '../../model/emailWorkflow'
import { assert, softAssert } from '../../utils/assert'
import { IdentityService } from '../identityService'
import { SourceService } from '../sourceService'
import type { FusionAccount } from '../../model/account'
import { FusionReport } from '../fusionService/types'
import {
    registerHandlebarsHelpers,
    compileEmailTemplates,
    renderFusionReviewEmail,
    renderFusionReport,
    type FusionReviewEmailData,
    type FusionReportEmailData,
} from './helpers'

// ============================================================================
// MessagingService Class
// ============================================================================

/**
 * Service for sending emails to reviewers via workflows.
 * Handles workflow creation, email composition, and notification delivery.
 */
export class MessagingService {
    private _workflow: WorkflowV2025 | undefined
    private _templates: Map<string, HandlebarsTemplateDelegate> = new Map()
    private readonly workflowName: string
    private readonly cloudDisplayName: string

    // ------------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------------

    constructor(
        config: FusionConfig,
        private log: LogService,
        private client: ClientService,
        private sources: SourceService,
        private identities?: IdentityService
    ) {
        this.workflowName = config.workflowName
        this.cloudDisplayName = config.cloudDisplayName
        registerHandlebarsHelpers()
        this._templates = compileEmailTemplates()
    }

    // ------------------------------------------------------------------------
    // Public Methods
    // ------------------------------------------------------------------------

    /**
     * Prepare the email sender workflow by checking for existence and creating if needed.
     * This should be called before sending any emails to ensure the workflow is ready.
     */
    public async fetchSender(): Promise<void> {
        if (this._workflow) {
            this.log.debug('Email workflow already prepared')
            return
        }

        assert(this.workflowName, 'Workflow name is required')
        assert(this.cloudDisplayName, 'Cloud display name is required')

        const workflowName = `${this.workflowName} (${this.cloudDisplayName})`
        this.log.debug(`Preparing email sender workflow: ${workflowName}`)

        const owner = this.sources.fusionSourceOwner
        assert(owner, 'Fusion source owner is required')
        assert(owner.id, 'Fusion source owner ID is required')

        // First, check if the workflow already exists
        const existingWorkflow = await this.findWorkflowByName(workflowName)
        if (existingWorkflow) {
            this._workflow = existingWorkflow
            this.log.info(`Found existing workflow: ${workflowName} (ID: ${this._workflow.id})`)
            return
        }

        // Workflow doesn't exist, create it
        try {
            const emailWorkflow = new EmailWorkflow(workflowName, owner)
            assert(emailWorkflow, 'Failed to create email workflow object')

            this._workflow = await this.createWorkflow(emailWorkflow)
            assert(this._workflow, 'Failed to create workflow')
            assert(this._workflow.id, 'Workflow ID is required')

            this.log.info(`Created workflow: ${workflowName} (ID: ${this._workflow.id})`)
        } catch (error) {
            this.log.error(`Failed to create workflow: ${error}`)
            throw new Error(`Workflow preparation failed. Unable to create workflow "${workflowName}": ${error}`)
        }
    }

    /**
     * Send email notification for a fusion form (deduplication review)
     */
    public async sendFusionEmail(formInstance: FormInstanceResponseV2025): Promise<void> {
        assert(formInstance, 'Form instance is required')
        assert(formInstance.id, 'Form instance ID is required')

        const { formInput, recipients } = formInstance

        if (!recipients || recipients.length === 0) {
            this.log.warn(`No recipients found for form instance ${formInstance.id}`)
            return
        }

        const recipientEmails = await this.getRecipientEmails(recipients.map((r) => r.id))
        if (recipientEmails.length === 0) {
            this.log.warn(`No valid email addresses found for form instance ${formInstance.id}`)
            return
        }

        assert(formInput, 'Form input is required')
        const account = formInput?.account as any
        assert(account, 'Account data is required in form input')

        const accountName = account?.displayName || account?.value || 'Unknown Account'
        const candidates = (formInput?.candidates as any[]) || []

        const subject = `Identity Fusion Review Required: ${accountName}`
        const emailData: FusionReviewEmailData = {
            accountName,
            accountSource: account?.sourceName || 'Unknown',
            accountAttributes: account?.attributes || {},
            candidates: candidates.map((candidate: any) => ({
                id: candidate.value || candidate.id || 'Unknown',
                name: candidate.displayName || candidate.name || 'Unknown',
                attributes: candidate.attributes || {},
                scores: candidate.scores,
            })),
            formInstanceId: formInstance.id,
        }

        assert(this._templates, 'Email templates are required')
        const body = renderFusionReviewEmail(this._templates, emailData)
        assert(body, 'Failed to render fusion review email body')

        await this.sendEmail(recipientEmails, subject, body)
        this.log.info(`Sent fusion email to ${recipientEmails.length} recipient(s) for form ${formInstance.id}`)
    }

    /**
     * Send report email with potential duplicate accounts
     */
    public async sendReport(report: FusionReport, fusionAccount?: FusionAccount): Promise<void> {
        // Get recipient email from fusion account if provided
        const recipientEmails: string[] = []

        if (fusionAccount?.email) {
            recipientEmails.push(fusionAccount.email)
        } else if (fusionAccount && this.identities) {
            // Try to get email from identity
            const identity = this.identities.getIdentityById(fusionAccount.identityId)
            if (identity?.attributes?.email) {
                recipientEmails.push(identity.attributes.email)
            }
        }

        if (recipientEmails.length === 0) {
            this.log.warn('No recipient email found for report')
            return
        }

        const subject = `Identity Fusion Report - ${report.potentialDuplicates || 0} Potential Duplicate(s) Found`
        const emailData: FusionReportEmailData = {
            ...report,
            totalAccounts: report.totalAccounts || report.accounts.length,
            potentialDuplicates:
                report.potentialDuplicates || report.accounts.filter((a) => a.matches.length > 0).length,
            reportDate: report.reportDate || new Date(),
            accountName: fusionAccount?.name || fusionAccount?.displayName,
        }
        const body = renderFusionReport(this._templates, emailData)

        await this.sendEmail(recipientEmails, subject, body)
        this.log.info(`Sent fusion report email to ${recipientEmails.length} recipient(s)`)
    }

    // ------------------------------------------------------------------------
    // Private Helper Methods
    // ------------------------------------------------------------------------

    /**
     * Get the workflow, ensuring it's prepared first
     */
    private async getWorkflow(): Promise<WorkflowV2025> {
        if (!this._workflow) {
            await this.fetchSender()
        }
        if (!this._workflow) {
            throw new Error('Workflow not available after preparation')
        }
        return this._workflow
    }

    /**
     * Send an email using the workflow
     */
    private async sendEmail(recipients: string[], subject: string, body: string): Promise<void> {
        assert(recipients, 'Recipients array is required')
        assert(recipients.length > 0, 'At least one recipient is required')
        assert(subject, 'Email subject is required')
        assert(body, 'Email body is required')

        const workflow = await this.getWorkflow()
        assert(workflow, 'Workflow is required')
        assert(workflow.id, 'Workflow ID is required')

        const testRequest: TestWorkflowRequestV2025 = {
            input: {
                subject,
                body,
                recipients,
            },
        }

        const requestParameters: WorkflowsV2025ApiTestWorkflowRequest = {
            id: workflow.id,
            testWorkflowRequestV2025: testRequest,
        }

        this.log.debug(`Sending email to ${recipients.length} recipient(s) via workflow ${workflow.id}`)
        const response = await this.testWorkflow(requestParameters)
        assert(response, 'Workflow response is required')
        softAssert(response.status === 200, `Failed to send email - received status ${response.status}`, 'error')
    }

    /**
     * Get email addresses for recipient identity IDs
     */
    private async getRecipientEmails(identityIds: (string | undefined)[]): Promise<string[]> {
        const emails: string[] = []

        for (const identityId of identityIds) {
            if (!identityId) {
                continue
            }

            if (!this.identities) {
                this.log.warn('IdentityService not available, cannot fetch recipient emails')
                continue
            }

            const identity = this.identities.getIdentityById(identityId)
            if (identity?.attributes?.email) {
                emails.push(identity.attributes.email)
            } else {
                this.log.warn(`No email found for identity ${identityId}`)
            }
        }

        return emails
    }

    // ------------------------------------------------------------------------
    // Workflow API Operations
    // ------------------------------------------------------------------------

    /**
     * Find a workflow by name
     */
    private async findWorkflowByName(workflowName: string): Promise<WorkflowV2025 | undefined> {
        assert(workflowName, 'Workflow name is required')
        assert(this.client, 'Client service is required')

        const { workflowsApi } = this.client

        this.log.debug(`Searching for existing workflow: ${workflowName}`)
        const listWorkflows = async () => {
            const response = await workflowsApi.listWorkflows()
            return {
                data: response.data || [],
            }
        }

        const workflows = await this.client.execute(listWorkflows)

        const workflow = workflows.data.find((w) => w.name === workflowName)

        return workflow
    }

    /**
     * Create a workflow
     */
    private async createWorkflow(createWorkflowRequestV2025: CreateWorkflowRequestV2025): Promise<WorkflowV2025> {
        assert(createWorkflowRequestV2025, 'Workflow request is required')
        assert(this.client, 'Client service is required')

        const { workflowsApi } = this.client
        assert(workflowsApi, 'Workflows API is required')

        this.log.debug('Creating email workflow')
        const createWorkflowFn = async () => {
            const response = await workflowsApi.createWorkflow({ createWorkflowRequestV2025 })
            return response.data
        }
        const workflowData = await this.client.execute(createWorkflowFn)
        assert(workflowData, 'Failed to create workflow')
        assert(workflowData.id, 'Workflow ID is required')

        return workflowData
    }

    /**
     * Test/execute a workflow
     */
    private async testWorkflow(requestParameters: WorkflowsV2025ApiTestWorkflowRequest) {
        assert(requestParameters, 'Workflow request parameters are required')
        assert(requestParameters.id, 'Workflow ID is required')
        assert(requestParameters.testWorkflowRequestV2025, 'Test workflow request is required')
        assert(this.client, 'Client service is required')

        const { workflowsApi } = this.client
        assert(workflowsApi, 'Workflows API is required')

        this.log.debug(`Executing workflow ${requestParameters.id}`)
        const testWorkflowFn = async () => {
            const response = await workflowsApi.testWorkflow(requestParameters)
            return response
        }
        const response = await this.client.execute(testWorkflowFn)
        assert(response, 'Workflow response is required')
        this.log.debug(`Workflow executed. Response code ${response.status}`)
        return response
    }
}
