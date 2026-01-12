import {
    FormInstanceResponseV2025,
    WorkflowV2025,
    WorkflowsV2025ApiCreateWorkflowRequest,
    TestWorkflowRequestV2025,
    WorkflowsV2025ApiTestWorkflowRequest,
} from 'sailpoint-api-client'
import type { TemplateDelegate as HandlebarsTemplateDelegate } from 'handlebars'
import { FusionConfig } from '../../model/config'
import { ClientService } from '../clientService'
import { LogService } from '../logService'
import { EmailWorkflow } from '../../model/emailWorkflow'
import { softAssert } from '../../utils/assert'
import { IdentityService } from '../identityService'
import type { FusionAccount } from '../../model/account'
import { FusionReport } from '../fusionService/types'
import {
    registerHandlebarsHelpers,
    compileEmailTemplates,
    renderFusionReviewEmail,
    renderEditRequestEmail,
    renderFusionReport,
    type FusionReviewEmailData,
    type EditRequestEmailData,
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
    private readonly managementWorkgroup: FusionConfig['managementWorkgroup']

    // ------------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------------

    constructor(
        config: FusionConfig,
        private log: LogService,
        private client: ClientService,
        private identities?: IdentityService
    ) {
        this.workflowName = config.workflowName
        this.cloudDisplayName = config.cloudDisplayName
        this.managementWorkgroup = config.managementWorkgroup
        registerHandlebarsHelpers()
        this._templates = compileEmailTemplates()
    }

    // ------------------------------------------------------------------------
    // Public Methods
    // ------------------------------------------------------------------------

    /**
     * Prepare the email sender workflow by checking for existence and creating if needed.
     * This should be called before sending any emails to ensure the workflow is ready.
     *
     * Note: Workflows are not directly searchable via the search API, so this method
     * will create the workflow if it's not already cached. If the workflow already exists
     * in ISC, the creation may fail - in that case, the workflow should be manually
     * configured or the error should be handled by the caller.
     */
    public async prepareSender(): Promise<void> {
        if (this._workflow) {
            this.log.debug('Email workflow already prepared')
            return
        }

        const workflowName = `${this.workflowName} (${this.cloudDisplayName})`
        this.log.debug(`Preparing email sender workflow: ${workflowName}`)

        const owner = this.managementWorkgroup
        if (!owner || !owner.id) {
            throw new Error('Management workgroup not found in config - cannot create workflow')
        }

        const ownerDto = {
            id: owner.id,
            type: 'IDENTITY' as const,
        }

        try {
            // Attempt to create the workflow
            // If it already exists, this will fail and should be handled by the caller
            const emailWorkflow = new EmailWorkflow(workflowName, ownerDto)
            this._workflow = await this.createWorkflow(emailWorkflow)
            this.log.info(`Created workflow: ${workflowName} (ID: ${this._workflow.id})`)
        } catch (error) {
            // Workflow may already exist - log warning but don't fail
            // In production, you may want to search for existing workflow via a different method
            this.log.warn(`Failed to create workflow (may already exist): ${error}`)
            throw new Error(`Workflow preparation failed. Ensure workflow "${workflowName}" exists or can be created.`)
        }
    }

    /**
     * Send email notification for a fusion form (deduplication review)
     */
    public async sendFusionEmail(formInstance: FormInstanceResponseV2025): Promise<void> {
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

        const account = formInput?.account as any
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
        const body = renderFusionReviewEmail(this._templates, emailData)

        await this.sendEmail(recipientEmails, subject, body)
        this.log.info(`Sent fusion email to ${recipientEmails.length} recipient(s) for form ${formInstance.id}`)
    }

    /**
     * Send email notification for an edit form
     */
    public async sendEditEmail(formInstance: FormInstanceResponseV2025): Promise<void> {
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

        const account = formInput?.account as any
        const accountName = account?.displayName || account?.value || 'Unknown Account'

        const subject = `Identity Fusion Account Edit Required: ${accountName}`
        const emailData: EditRequestEmailData = {
            accountName,
            accountSource: account?.sourceName || 'Unknown',
            accountAttributes: account?.attributes || {},
            formInstanceId: formInstance.id,
        }
        const body = renderEditRequestEmail(this._templates, emailData)

        await this.sendEmail(recipientEmails, subject, body)
        this.log.info(`Sent edit email to ${recipientEmails.length} recipient(s) for form ${formInstance.id}`)
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
            await this.prepareSender()
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
        const workflow = await this.getWorkflow()
        if (!workflow.id) {
            throw new Error('Workflow ID not available')
        }

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

        const response = await this.testWorkflow(requestParameters)
        softAssert(response.status === 200, 'Failed to send email')
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
     * Create a workflow
     */
    private async createWorkflow(workflow: WorkflowsV2025ApiCreateWorkflowRequest): Promise<WorkflowV2025> {
        const createWorkflowFn = async () => {
            const response = await this.client.workflowsApi.createWorkflow(workflow.createWorkflowRequestV2025 as any)
            return response.data
        }
        const workflowData = await this.client.execute(createWorkflowFn)
        return workflowData
    }

    /**
     * Test/execute a workflow
     */
    private async testWorkflow(requestParameters: WorkflowsV2025ApiTestWorkflowRequest) {
        const testWorkflowFn = async () => {
            const response = await this.client.workflowsApi.testWorkflow({
                id: requestParameters.id,
                testWorkflowRequest: requestParameters.testWorkflowRequestV2025 as any,
            })
            return response
        }
        const response = await this.client.execute(testWorkflowFn)
        this.log.debug(`Workflow executed. Response code ${response.status}`)
        return response
    }
}
