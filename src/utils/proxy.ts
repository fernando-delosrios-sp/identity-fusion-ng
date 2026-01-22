// Replace index.ts with this file to run the connector on a proxy server
// Add a proxy_url configuration parameter to your ISC source

import { CommandHandler, ConnectorError, logger } from '@sailpoint/connector-sdk'
import { safeReadConfig } from '../data/config'
import { FusionConfig } from '../model/config'
import { assert } from 'console'
const KEEPALIVE = 2.5 * 60 * 1000

// Helper function to unwrap {data:{}} structures
const unwrapData = (obj: any): any => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return obj
    }

    // If object has 'data' key, extract and unwrap it
    if ('data' in obj && typeof obj.data === 'object' && obj.data !== null) {
        logger.debug(`Unwrapping data field. Object keys: ${Object.keys(obj).join(', ')}`)
        const unwrapped = obj.data
        // Recursively unwrap in case of nested wrapping
        return unwrapData(unwrapped)
    }

    return obj
}

// Proxy Client Mode: Forward requests to external connector
export const isProxyMode = (config: FusionConfig): boolean => {
    const proxyEnabled = config.proxyEnabled ?? false
    const hasProxyUrl = config.proxyUrl !== undefined && config.proxyUrl !== ''
    const isServer = process.env.PROXY_PASSWORD !== undefined

    // Client mode: has proxyUrl and is NOT the server
    return proxyEnabled && hasProxyUrl && !isServer
}

// Proxy Server Mode: Receive and process requests from internal connector
export const isProxyService = (config: FusionConfig): boolean => {
    const proxyEnabled = config.proxyEnabled ?? false
    const hasProxyPassword = process.env.PROXY_PASSWORD !== undefined

    if (proxyEnabled && hasProxyPassword) {
        logger.info('Running as proxy server')
        // Validate password if provided in config
        if (config.proxyPassword) {
            const serverPassword = process.env.PROXY_PASSWORD
            const clientPassword = config.proxyPassword
            assert(serverPassword === clientPassword, 'Proxy password mismatch')
        }
    }

    return proxyEnabled && hasProxyPassword
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
        // Disable proxy mode in the config sent to external connector to prevent infinite loop
        const externalConfig = { ...config, proxyEnabled: false }
        const body = {
            type: context.commandType,
            input,
            config: externalConfig,
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
            logger.debug('Proxy received empty response')
            return
        }

        logger.debug(`Proxy received response (${data.length} chars): ${data.substring(0, 500)}${data.length > 500 ? '...' : ''}`)

        // Try to parse as NDJSON first (newline-delimited JSON)
        const lines = data.split('\n').filter(line => line.trim().length > 0)
        logger.debug(`Processing ${lines.length} non-empty lines from proxy response`)

        // Check if response is a single JSON array instead of NDJSON
        if (lines.length === 1) {
            try {
                let parsed = JSON.parse(lines[0])

                // Unwrap any {data:{}} structure
                logger.debug(`Before unwrap - parsed keys: ${Object.keys(parsed).join(', ')}`)
                parsed = unwrapData(parsed)
                logger.debug(`After unwrap - parsed keys: ${Object.keys(parsed).join(', ')}`)

                // If it's an array, send each item
                if (Array.isArray(parsed)) {
                    logger.info(`Proxy received JSON array with ${parsed.length} items`)
                    for (const item of parsed) {
                        const unwrappedItem = unwrapData(item)
                        logger.debug(`Sending item: ${JSON.stringify(unwrappedItem).substring(0, 200)}`)
                        res.send(unwrappedItem)
                    }
                    return
                } else {
                    // Single object - send the data directly
                    logger.debug(`Sending single object: ${JSON.stringify(parsed).substring(0, 200)}`)
                    res.send(parsed)
                    return
                }
            } catch (e) {
                logger.warn('Failed to parse response as JSON array, trying NDJSON')
            }
        }

        // Process as NDJSON
        let validObjectCount = 0
        for (const line of lines) {
            try {
                let parsed = JSON.parse(line)

                // Unwrap any {data:{}} structure
                parsed = unwrapData(parsed)

                // Validate that it's a proper object
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    logger.warn(`Skipping non-object: ${JSON.stringify(parsed)}`)
                    continue
                }

                // Validate required fields for account objects
                // Note: Different command types have different requirements
                if (context.commandType === 'std:account:list' || context.commandType === 'std:account:read') {
                    if (!parsed.identity) {
                        logger.error(`Object missing 'identity' field: ${JSON.stringify(parsed).substring(0, 200)}`)
                        throw new ConnectorError(`Proxy response object missing required 'identity' field`)
                    }
                    if (!parsed.uuid) {
                        logger.error(`Object missing 'uuid' field: ${JSON.stringify(parsed).substring(0, 200)}`)
                        throw new ConnectorError(`Proxy response object missing required 'uuid' field`)
                    }
                    if (!parsed.attributes || typeof parsed.attributes !== 'object') {
                        logger.error(`Object has invalid 'attributes' field: ${JSON.stringify(parsed).substring(0, 200)}`)
                        throw new ConnectorError(`Proxy response object missing or invalid 'attributes' field`)
                    }
                }

                logger.debug(`Sending valid object: ${JSON.stringify(parsed).substring(0, 200)}`)
                res.send(parsed)
                validObjectCount++
            } catch (parseError) {
                logger.error(`Failed to parse line: ${line.substring(0, 200)}`)
                throw new ConnectorError(
                    `Failed to parse JSON line from proxy response: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}. Line: ${line.substring(0, 100)}`
                )
            }
        }

        logger.info(`Proxy sent ${validObjectCount} valid objects to ISC`)
    } catch (error) {
        throw new ConnectorError(error instanceof Error ? error.message : 'Unknown error')
    } finally {
        clearInterval(interval)
    }
}


