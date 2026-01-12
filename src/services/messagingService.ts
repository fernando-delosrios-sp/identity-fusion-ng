import {
    FormInstanceResponseV2025,
    WorkflowV2025,
    WorkflowsV2025ApiCreateWorkflowRequest,
    TestWorkflowRequestV2025,
    WorkflowsV2025ApiTestWorkflowRequest,
} from 'sailpoint-api-client'
import Handlebars from 'handlebars'
import { FusionConfig } from '../model/config'
import { ClientService } from './clientService'
import { LogService } from './logService'
import { EmailWorkflow } from '../model/emailWorkflow'
import { softAssert } from '../utils/assert'
import { IdentityService } from './identityService'
import type { FusionAccount } from '../model/account'
import { FUSION_REVIEW_TEMPLATE, EDIT_REQUEST_TEMPLATE, FUSION_REPORT_TEMPLATE } from '../model/messages'

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
        this.registerHelpers()
        this.compileTemplates()
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
        const body = this.renderFusionReviewEmail({
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
        })

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
        const body = this.renderEditRequestEmail({
            accountName,
            accountSource: account?.sourceName || 'Unknown',
            accountAttributes: account?.attributes || {},
            formInstanceId: formInstance.id,
        })

        await this.sendEmail(recipientEmails, subject, body)
        this.log.info(`Sent edit email to ${recipientEmails.length} recipient(s) for form ${formInstance.id}`)
    }

    /**
     * Send report email with potential duplicate accounts
     */
    public async sendReport(
        report: {
            accounts: Array<{
                accountName: string
                accountSource: string
                accountId?: string
                accountEmail?: string
                accountAttributes?: Record<string, any>
                matches: Array<{
                    identityName: string
                    identityId?: string
                    isMatch: boolean
                    scores?: Array<{
                        attribute: string
                        algorithm?: string
                        score: number
                        fusionScore?: number
                        isMatch: boolean
                        comment?: string
                    }>
                }>
            }>
            totalAccounts?: number
            potentialDuplicates?: number
            reportDate?: Date | string
        },
        fusionAccount?: FusionAccount
    ): Promise<void> {
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
        const body = this.renderFusionReport({
            accounts: report.accounts,
            totalAccounts: report.totalAccounts || report.accounts.length,
            potentialDuplicates:
                report.potentialDuplicates || report.accounts.filter((a) => a.matches.length > 0).length,
            reportDate: report.reportDate || new Date(),
            accountName: fusionAccount?.name || fusionAccount?.displayName,
        })

        await this.sendEmail(recipientEmails, subject, body)
        this.log.info(`Sent fusion report email to ${recipientEmails.length} recipient(s)`)
    }

    // ------------------------------------------------------------------------
    // Private Helper Methods
    // ------------------------------------------------------------------------

    /**
     * Register Handlebars helpers for common operations
     */
    private registerHelpers(): void {
        // Format attribute values for display
        Handlebars.registerHelper('formatAttribute', (value: any) => {
            if (value === null || value === undefined) {
                return 'N/A'
            }
            if (typeof value === 'object') {
                return JSON.stringify(value)
            }
            return String(value)
        })

        // Format scores for display
        Handlebars.registerHelper('formatScores', (scores: any[]) => {
            if (!scores || scores.length === 0) {
                return 'N/A'
            }
            return scores
                .map((score) => `${score.attribute}: ${score.score}% (${score.isMatch ? 'Match' : 'No Match'})`)
                .join(', ')
        })

        // Check if value exists
        Handlebars.registerHelper('exists', (value: any) => {
            return value !== null && value !== undefined && value !== ''
        })

        // Greater than helper
        Handlebars.registerHelper('gt', (a: number, b: number) => {
            return a > b
        })

        // Greater than or equal helper
        Handlebars.registerHelper('gte', (a: number, b: number) => {
            return a >= b
        })

        // Format date
        Handlebars.registerHelper('formatDate', (date: string | Date) => {
            if (!date) {
                return 'N/A'
            }
            const d = typeof date === 'string' ? new Date(date) : date
            return d.toLocaleDateString()
        })
    }

    /**
     * Compile all email templates
     */
    private compileTemplates(): void {
        this._templates.set('fusion-review', Handlebars.compile(FUSION_REVIEW_TEMPLATE))
        this._templates.set('edit-request', Handlebars.compile(EDIT_REQUEST_TEMPLATE))
        this._templates.set('fusion-report', Handlebars.compile(FUSION_REPORT_TEMPLATE))
    }

    /**
     * Render fusion review email template
     */
    private renderFusionReviewEmail(data: {
        accountName: string
        accountSource: string
        accountAttributes: Record<string, any>
        candidates: Array<{
            id: string
            name: string
            attributes: Record<string, any>
            scores?: any[]
        }>
        formInstanceId?: string
    }): string {
        const template = this._templates.get('fusion-review')
        if (!template) {
            throw new Error('Fusion review template not found')
        }
        return template(data)
    }

    /**
     * Render edit request email template
     */
    private renderEditRequestEmail(data: {
        accountName: string
        accountSource: string
        accountAttributes: Record<string, any>
        formInstanceId?: string
    }): string {
        const template = this._templates.get('edit-request')
        if (!template) {
            throw new Error('Edit request template not found')
        }
        return template(data)
    }

    /**
     * Render fusion report email template
     */
    private renderFusionReport(data: {
        accounts: Array<{
            accountName: string
            accountSource: string
            accountId?: string
            accountEmail?: string
            accountAttributes?: Record<string, any>
            matches: Array<{
                identityName: string
                identityId?: string
                isMatch: boolean
                scores?: Array<{
                    attribute: string
                    algorithm?: string
                    score: number
                    fusionScore?: number
                    isMatch: boolean
                    comment?: string
                }>
            }>
        }>
        totalAccounts: number
        potentialDuplicates: number
        reportDate: Date | string
        accountName?: string
    }): string {
        const template = this._templates.get('fusion-report')
        if (!template) {
            throw new Error('Fusion report template not found')
        }
        return template(data)
    }

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
