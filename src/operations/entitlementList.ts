import { Response, StdEntitlementListInput, StdEntitlementListOutput } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'

export const entitlementList = async (
    serviceRegistry: ServiceRegistry,
    input: StdEntitlementListInput,
    res: Response<StdEntitlementListOutput>
) => {
    ServiceRegistry.setCurrent(serviceRegistry)
    const { log } = serviceRegistry

    try {
        log.info(`Listing entitlements for type ${input.type}...`)

        // TODO: Implement entitlement listing logic

        log.info(`Entitlement listing for type ${input.type} completed`)
    } catch (error) {
        log.crash(`Failed to list entitlements for type ${input.type}`, error)
    }
}

