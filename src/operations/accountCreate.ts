import { Response, StdAccountCreateInput, StdAccountCreateOutput } from '@sailpoint/connector-sdk'
import { ServiceRegistry } from '../services/serviceRegistry'

export const accountCreate = async (
    serviceRegistry: ServiceRegistry,
    input: StdAccountCreateInput,
    res: Response<StdAccountCreateOutput>
) => {
    ServiceRegistry.setCurrent(serviceRegistry)
    const { log } = serviceRegistry

    try {
        log.info(`Creating account ${input.attributes.name ?? input.identity}...`)

        // TODO: Implement account creation logic

        log.info(`Account ${input.attributes.name ?? input.identity} creation completed`)
    } catch (error) {
        log.crash(`Failed to create account ${input.attributes.name ?? input.identity}`, error)
    }
}

