import {
    OwnerDto,
    WorkflowBodyOwnerBeta,
    CreateWorkflowRequestV2025,
    WorkflowsV2025ApiCreateWorkflowRequest,
} from 'sailpoint-api-client'

export class EmailWorkflow implements WorkflowsV2025ApiCreateWorkflowRequest {
    createWorkflowRequestV2025: CreateWorkflowRequestV2025

    constructor(name: string, owner: OwnerDto) {
        this.createWorkflowRequestV2025 = {
            name,
            owner: owner as WorkflowBodyOwnerBeta,
            definition: {
                start: 'Send Email',
                steps: {
                    'End Step - Success': {
                        type: 'success',
                    },
                    'Send Email': {
                        actionId: 'sp:send-email',
                        attributes: {
                            'body.$': '$.trigger.body',
                            context: {},
                            'recipientEmailList.$': '$.trigger.recipients',
                            'subject.$': '$.trigger.subject',
                        },
                        nextStep: 'End Step - Success',
                        type: 'action',
                        versionNumber: 2,
                    },
                },
            },
            trigger: {
                type: 'EXTERNAL',
                attributes: {
                    id: 'idn:external:id',
                    frequency: 'daily',
                },
            },
        }
    }
}
