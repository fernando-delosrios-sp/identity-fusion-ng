import { Response, StdAccountUpdateInput, StdAccountUpdateOutput } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'

export const accountUpdate = async (
    serviceRegistry: ServiceRegistry,
    input: StdAccountUpdateInput,
    res: Response<StdAccountUpdateOutput>
) => {
    ServiceRegistry.setCurrent(serviceRegistry)
    const { log } = serviceRegistry

    try {
        log.info(`Updating account ${input.identity}...`)

        // TODO: Implement account update logic

        log.info(`Account ${input.identity} update completed`)
    } catch (error) {
        log.crash(`Failed to update account ${input.identity}`, error)
    }
}

