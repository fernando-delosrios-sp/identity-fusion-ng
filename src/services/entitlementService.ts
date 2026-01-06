import { FusionConfig } from '../model/config'
import { LogService } from './logService'
import { Status } from '../model/status'
import { Action } from '../model/action'
import { statuses } from '../data/status'
import { actions } from '../data/action'
import { Source } from 'sailpoint-api-client'

/**
 * Service for building status and action entitlements.
 */
export class EntitlementService {
    constructor(
        private config: FusionConfig,
        private log: LogService
    ) {}

    /**
     * Build status entitlements
     */
    public buildStatusEntitlements(): Status[] {
        return statuses.map((x) => new Status(x))
    }

    /**
     * Build action entitlements
     */
    public buildActionEntitlements(sources: Source[]): Action[] {
        const actionEntitlements = actions.map((x) => new Action(x))

        // Create source-specific reviewer entitlements
        const sourceInput = sources.map(({ id, name }) => ({
            id: id!,
            name: `${name} reviewer`,
            description: `Reviewer for source ${name} potentially duplicated identities`,
        }))

        const sourceEntitlements = sourceInput.map((x) => new Action(x))
        return [...actionEntitlements, ...sourceEntitlements]
    }
}
