import {
    FormInstanceResponseV2025,
    WorkflowV2025,
    WorkflowsV2025ApiCreateWorkflowRequest,
    TestWorkflowRequestV2025,
} from 'sailpoint-api-client'
import { FusionConfig } from '../model/config'
import { ClientService } from './clientService'
import { LogService } from './logService'
import { EmailWorkflow } from '../model/emailWorkflow'
import { softAssert } from '../utils/assert'

export class MessagingService {
    private _workflow: WorkflowV2025 | undefined
    constructor(
        private config: FusionConfig,
        private log: LogService,
        private client: ClientService
    ) {}

    // private async fetchWorkflow() {
    //     const workflowName = `${this.config.workflowName} (${this.config!.cloudDisplayName})`
    //     // Note: listWorkflows doesn't exist in the API, workflows are typically created/managed differently
    //     // This is a placeholder - you may need to adjust based on actual workflow management
    //     let workflow = this._workflow
    //     if (!workflow) {
    //         this.log.info(`Creating workflow: ${workflowName}`)
    //         const emailWorkflow = new EmailWorkflow(workflowName, this.config!.cloudDisplayName)
    //         workflow = await this.createWorkflow(emailWorkflow as any)
    //     }
    //     return workflow
    // }

    // private async getWorkflow() {
    //     if (this._workflow) {
    //         return this._workflow
    //     }
    //     this._workflow = await this.fetchWorkflow()
    //     return this._workflow
    // }

    // private async sendEmail(recipient: string, subject: string, body: string): Promise<void> {
    //     const workflow = await this.getWorkflow()
    //     if (!workflow?.id) {
    //         throw new Error('Workflow not available')
    //     }
    //     const testRequest: TestWorkflowRequestV2025 = {
    //         // Add test request parameters
    //     } as any
    //     const response = await this.testWorkflow(workflow.id, testRequest)

    //     softAssert(response.status === 200, 'Failed to send email')
    // }

    // // -------------------------------------------------------------------------
    // // Workflow API Operations (moved from ClientService)
    // // -------------------------------------------------------------------------

    // async createWorkflow(workflow: WorkflowsV2025ApiCreateWorkflowRequest): Promise<WorkflowV2025> {
    //     const response = await this.client.execute(() => this.client.workflowsApi.createWorkflow(workflow))
    //     return response.data
    // }

    // async testWorkflow(id: string, testWorkflowRequestV2025: TestWorkflowRequestV2025) {
    //     const response = await this.client.execute(() =>
    //         this.client.workflowsApi.testWorkflow({
    //             id,
    //             testWorkflowRequestV2025,
    //         })
    //     )
    //     this.log.info(`workflow sent. Response code ${response.status}`)
    //     return response
    // }

    // public async sendFusionEmail(formInstance: FormInstanceResponseV2025): Promise<void> {
    //     await this.sendEmail()
    // }

    // public async sendEditEmail(formInstance: FormInstanceResponseV2025): Promise<void> {
    //     await this.sendEmail()
    // }
}
