import {
    ConnectorError,
    ConnectorErrorType,
    StdAccountCreateHandler,
    StdAccountDisableHandler,
    StdAccountDiscoverSchemaHandler,
    StdAccountEnableHandler,
    StdAccountListHandler,
    StdAccountReadHandler,
    StdAccountUpdateHandler,
    StdEntitlementListHandler,
    StdTestConnectionHandler,
    createConnector,
    logger,
} from '@sailpoint/connector-sdk'
import { safeReadConfig } from './data/config'

import { FusionConfig } from './model/config'
import { ServiceRegistry } from './services/serviceRegistry'
import { testConnection } from './operations/testConnection'
import { accountList } from './operations/accountList'
import { accountRead } from './operations/accountRead'
import { accountCreate } from './operations/accountCreate'
import { accountUpdate } from './operations/accountUpdate'
import { accountEnable } from './operations/accountEnable'
import { accountDisable } from './operations/accountDisable'
import { entitlementList } from './operations/entitlementList'
import { accountDiscoverSchema } from './operations/accountDiscoverSchema'

// Connector must be exported as module property named connector
export const connector = async () => {
    const config: FusionConfig = await safeReadConfig()
    //==============================================================================================================

    const stdTest: StdTestConnectionHandler = async (context, input, res) => {
        try {
            const serviceRegistry = new ServiceRegistry(config, context)
            if (context.testConnection) {
                logger.info('Using custom test connection implementation')
            }
            const testConnectionImpl: typeof testConnection = context.testConnection ?? testConnection
            await testConnectionImpl(serviceRegistry, input, res)
        } catch (error) {
            logger.error(error)
            throw new ConnectorError('Failed to test connection', ConnectorErrorType.Generic)
        } finally {
            ServiceRegistry.clear()
        }
    }

    const stdAccountList: StdAccountListHandler = async (context, input, res): Promise<void> => {
        const interval = setInterval(() => {
            res.keepAlive()
        }, config.processingWaitConstant)

        try {
            const serviceRegistry = new ServiceRegistry(config, context)
            if (context.accountList) {
                logger.info('Using custom account list implementation')
            }
            const accountListImpl: typeof accountList = context.accountList ?? accountList
            await accountListImpl(serviceRegistry, input, res)
        } catch (error) {
            logger.error(error)
            throw new ConnectorError('Failed to aggregate accounts', ConnectorErrorType.Generic)
        } finally {
            ServiceRegistry.clear()
            clearInterval(interval)
        }
    }

    const stdAccountRead: StdAccountReadHandler = async (context, input, res): Promise<void> => {
        try {
            const serviceRegistry = new ServiceRegistry(config, context)
            if (context.accountRead) {
                logger.info('Using custom account read implementation')
            }
            const accountReadImpl: typeof accountRead = context.accountRead ?? accountRead
            await accountReadImpl(serviceRegistry, input, res)
        } catch (error) {
            logger.error(error)
            throw new ConnectorError(`Failed to read account ${input.identity}`, ConnectorErrorType.Generic)
        } finally {
            ServiceRegistry.clear()
        }
    }

    const stdAccountCreate: StdAccountCreateHandler = async (context, input, res) => {
        try {
            const serviceRegistry = new ServiceRegistry(config, context)
            if (context.accountCreate) {
                logger.info('Using custom account create implementation')
            }
            const accountCreateImpl: typeof accountCreate = context.accountCreate ?? accountCreate
            await accountCreateImpl(serviceRegistry, input, res)
        } catch (error) {
            logger.error(error)
            throw new ConnectorError(
                `Failed to create account ${input.attributes.name ?? input.identity}`,
                ConnectorErrorType.Generic
            )
        } finally {
            ServiceRegistry.clear()
        }
    }

    const stdAccountUpdate: StdAccountUpdateHandler = async (context, input, res) => {
        const interval = setInterval(() => {
            res.keepAlive()
        }, config.processingWaitConstant)

        try {
            const serviceRegistry = new ServiceRegistry(config, context)
            if (context.accountUpdate) {
                logger.info('Using custom account update implementation')
            }
            const accountUpdateImpl: typeof accountUpdate = context.accountUpdate ?? accountUpdate
            await accountUpdateImpl(serviceRegistry, input, res)
        } catch (error) {
            logger.error(error)
            throw new ConnectorError(`Failed to update account ${input.identity}`, ConnectorErrorType.Generic)
        } finally {
            ServiceRegistry.clear()
            clearInterval(interval)
        }
    }

    const stdAccountEnable: StdAccountEnableHandler = async (context, input, res) => {
        try {
            const serviceRegistry = new ServiceRegistry(config, context)
            if (context.accountEnable) {
                logger.info('Using custom account enable implementation')
            }
            const accountEnableImpl: typeof accountEnable = context.accountEnable ?? accountEnable
            await accountEnableImpl(serviceRegistry, input, res)
        } catch (error) {
            logger.error(error)
            throw new ConnectorError(`Failed to enable account ${input.identity}`, ConnectorErrorType.Generic)
        } finally {
            ServiceRegistry.clear()
        }
    }

    const stdAccountDisable: StdAccountDisableHandler = async (context, input, res) => {
        try {
            const serviceRegistry = new ServiceRegistry(config, context)
            if (context.accountDisable) {
                logger.info('Using custom account disable implementation')
            }
            const accountDisableImpl: typeof accountDisable = context.accountDisable ?? accountDisable
            await accountDisableImpl(serviceRegistry, input, res)
        } catch (error) {
            logger.error(error)
            throw new ConnectorError(`Failed to disable account ${input.identity}`, ConnectorErrorType.Generic)
        } finally {
            ServiceRegistry.clear()
        }
    }

    const stdEntitlementList: StdEntitlementListHandler = async (context, input, res) => {
        try {
            const serviceRegistry = new ServiceRegistry(config, context)
            if (context.entitlementList) {
                logger.info('Using custom entitlement list implementation')
            }
            const entitlementListImpl: typeof entitlementList = context.entitlementList ?? entitlementList
            await entitlementListImpl(serviceRegistry, input, res)
        } catch (error) {
            logger.error(error)
            throw new ConnectorError(`Failed to list entitlements for type ${input.type}`, ConnectorErrorType.Generic)
        } finally {
            ServiceRegistry.clear()
        }
    }

    const stdAccountDiscoverSchema: StdAccountDiscoverSchemaHandler = async (context, input, res) => {
        try {
            const serviceRegistry = new ServiceRegistry(config, context)
            if (context.accountDiscoverSchema) {
                logger.info('Using custom account discover schema implementation')
            }
            const accountDiscoverSchemaImpl: typeof accountDiscoverSchema =
                context.accountDiscoverSchema ?? accountDiscoverSchema
            await accountDiscoverSchemaImpl(serviceRegistry, res)
        } catch (error) {
            logger.error(error)
            throw new ConnectorError('Failed to discover schema', ConnectorErrorType.Generic)
        } finally {
            ServiceRegistry.clear()
        }
    }

    return createConnector()
        .stdTestConnection(stdTest)
        .stdAccountList(stdAccountList)
        .stdAccountRead(stdAccountRead)
        .stdAccountCreate(stdAccountCreate)
        .stdAccountUpdate(stdAccountUpdate)
        .stdAccountEnable(stdAccountEnable)
        .stdAccountDisable(stdAccountDisable)
        .stdEntitlementList(stdEntitlementList)
        .stdAccountDiscoverSchema(stdAccountDiscoverSchema)
}
