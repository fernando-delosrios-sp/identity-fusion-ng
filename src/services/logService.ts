import { ConnectorError, ConnectorErrorType, logger } from '@sailpoint/connector-sdk'

type Logger = typeof logger

type LogConfig = {
    spConnDebugLoggingEnabled: boolean
}

/**
 * Extracts the caller function name from the stack trace
 * @param skipFrames Number of stack frames to skip (default: 2 to skip this function and the logging method)
 * @returns The function name or undefined if not found
 */
export function getCallerFunctionName(skipFrames: number = 2): string | undefined {
    try {
        const stack = new Error().stack
        if (!stack) return undefined

        const lines = stack.split('\n')
        // Skip Error constructor, this function, and the logging method
        const callerLine = lines[skipFrames + 1]
        if (!callerLine) return undefined

        // Match various function name patterns:
        // - "    at functionName (file:line:col)"
        // - "    at ClassName.methodName (file:line:col)"
        // - "    at Object.methodName (file:line:col)"
        // - "    at /path/to/file:line:col" (anonymous)
        const patterns = [
            /at\s+(?:new\s+)?(\w+)\s*\(/, // functionName( or new ClassName(
            /at\s+(?:(\w+)\.)?(\w+)\s*\(/, // ClassName.methodName( or methodName(
            /at\s+Object\.(\w+)\s*\(/, // Object.methodName(
            /at\s+(\w+)\s*\(/, // functionName(
        ]

        for (const pattern of patterns) {
            const match = callerLine.match(pattern)
            if (match) {
                // For class methods, prefer method name over class name
                if (match[2]) return match[2]
                if (match[1]) return match[1]
            }
        }

        // If no match, try to extract from anonymous function context
        // Look for the module name in the file path
        const fileMatch = callerLine.match(/[/\\]([^/\\]+)\.(?:ts|js|tsx|jsx)/)
        if (fileMatch) {
            return fileMatch[1]
        }

        return undefined
    } catch {
        return undefined
    }
}

export class LogService {
    private logger: Logger

    constructor(private config: LogConfig) {
        this.logger = logger
        if (this.config.spConnDebugLoggingEnabled) {
            logger.level = 'debug'
        }
    }

    private formatMessage(message: string, data?: any): string {
        const functionName = getCallerFunctionName(3) || 'unknown'

        if (data === undefined || data === null) {
            return `${functionName}: ${message}`
        }

        // Handle Error objects
        if (data instanceof Error) {
            return `${functionName}: ${message} [Error: ${data.name}: ${data.message}${data.stack ? ' | Stack: ' + data.stack : ''}]`
        }

        // Handle primitives (string, number, boolean, bigint, symbol)
        if (['string', 'number', 'boolean', 'bigint', 'symbol'].includes(typeof data)) {
            return `${functionName}: ${message} ${String(data)}`
        }

        // Handle objects and arrays
        try {
            return `${functionName}: ${message} ${JSON.stringify(data)}`
        } catch (e) {
            // If data is not serializable
            return `${functionName}: ${message} [Unserializable data: ${JSON.stringify(data)}] ${e}`
        }
    }

    info(message: string, data?: any): void {
        const output = this.formatMessage(message, data)
        this.logger.info(output)
    }

    debug(message: string, data?: any): void {
        const output = this.formatMessage(message, data)
        this.logger.debug(output)
    }

    warn(message: string, data?: any): void {
        const output = this.formatMessage(message, data)
        this.logger.warn(output)
    }

    error(message: string, data?: any): void {
        const output = this.formatMessage(message, data)
        this.logger.error(output)
    }

    crash(message: string, data?: any): void {
        const output = this.formatMessage(message, data)
        this.logger.error(output)
        throw new ConnectorError(message, ConnectorErrorType.Generic)
    }
}
