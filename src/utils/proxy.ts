// Replace index.ts with this file to run the connector on a proxy server
// Add a proxy_url configuration parameter to your ISC source

import { CommandHandler, ConnectorError, createConnector } from '@sailpoint/connector-sdk'
import { safeReadConfig } from '../data/config'
import { FusionConfig } from '../model/config'
const KEEPALIVE = 2.5 * 60 * 1000

export const isProxyService = (config: FusionConfig) => {
    return config.proxyEnabled && process.env.PROXY_PASSWORD !== undefined
}

export const proxy: CommandHandler = async (context, input, res) => {
    const config: FusionConfig = await safeReadConfig()
    const interval = setInterval(() => {
        res.keepAlive()
    }, KEEPALIVE)
    try {
        if (!config.proxyEnabled || !config.proxyUrl) {
            throw new ConnectorError('Proxy mode is not enabled or proxy URL is missing')
        }
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

        // Check if response is successful
        if (!response.ok) {
            const errorText = await response.text()
            throw new ConnectorError(
                `Proxy server returned error status ${response.status}: ${errorText || response.statusText}`
            )
        }

        const data = await response.text()
        
        // Handle empty response
        if (!data || data.trim().length === 0) {
            return
        }

        // Process each line (for...of iterates over values, not indices)
        const lines = data.split('\n')
        for (const line of lines) {
            // Skip empty lines
            const trimmedLine = line.trim()
            if (trimmedLine.length === 0) {
                continue
            }

            try {
                const parsed = JSON.parse(trimmedLine)
                res.send(parsed)
            } catch (parseError) {
                // Log parse error but continue processing other lines
                throw new ConnectorError(
                    `Failed to parse JSON line from proxy response: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}. Line: ${trimmedLine.substring(0, 100)}`
                )
            }
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
