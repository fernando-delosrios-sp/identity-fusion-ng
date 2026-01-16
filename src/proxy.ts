// Replace index.ts with this file to run the connector on a proxy server
// Add a proxy_url configuration parameter to your ISC source

import { CommandHandler, ConnectorError, createConnector } from '@sailpoint/connector-sdk'
import { safeReadConfig } from './data/config'
import { FusionConfig } from './model/config'
const KEEPALIVE = 2.5 * 60 * 1000

const proxy: CommandHandler = async (context, input, res) => {
    const config: FusionConfig = await safeReadConfig()
    const interval = setInterval(() => {
        res.keepAlive()
    }, KEEPALIVE)
    try {
        const { proxyUrl } = config
        const body = {
            type: context.commandType,
            input,
            config,
        }
        const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        })
        const data = await response.text()
        for (const line in data.split('\n')) {
            res.send(JSON.parse(line))
        }
    } catch (error) {
        throw new ConnectorError(error instanceof Error ? error.message : 'Unknown error')
    } finally {
        clearInterval(interval)
    }
}

export const proxyConnector = async () => {
    return createConnector()
        .stdTestConnection(proxy)
        .stdAccountList(proxy)
        .stdAccountRead(proxy)
        .stdAccountCreate(proxy)
        .stdAccountUpdate(proxy)
        .stdAccountEnable(proxy)
        .stdAccountDisable(proxy)
        .stdAccountUnlock(proxy)
        .stdAccountDiscoverSchema(proxy)
        .stdChangePassword(proxy)
        .stdSourceDataDiscover(proxy)
        .stdSourceDataRead(proxy)
        .stdEntitlementRead(proxy)
        .stdEntitlementList(proxy)
}
