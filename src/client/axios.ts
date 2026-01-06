import { IAxiosRetryConfig } from 'axios-retry'
import { logger } from '@sailpoint/connector-sdk'
import axiosRetry from 'axios-retry'

const RETRIES = 20
const REQUESTSPERSECOND = 10

/**
 * Creates an axios retry configuration from the provided parameters
 * @param retries - Maximum number of retry attempts (defaults to RETRIES constant)
 * @returns IAxiosRetryConfig configuration object
 */
export function createRetriesConfig(retries?: number): IAxiosRetryConfig {
    return {
        retries: retries ?? RETRIES,
        retryDelay: (retryCount, error) => {
            // Handle 429 rate limiting with retry-after header
            if (error?.response?.status === 429) {
                const retryAfter = error.response.headers?.['retry-after']
                if (retryAfter) {
                    const delay = parseInt(retryAfter, 10)
                    if (!isNaN(delay)) {
                        return delay * 1000 // Convert to milliseconds
                    }
                }
            }

            // Exponential backoff with jitter for other retryable errors
            const baseDelay = 1000 // 1 second base
            const exponentialDelay = baseDelay * Math.pow(2, retryCount)
            const jitter = Math.random() * 0.3 * exponentialDelay // Add up to 30% jitter
            const maxDelay = 60000 // Cap at 60 seconds

            return Math.min(exponentialDelay + jitter, maxDelay)
        },
        retryCondition: (error) => {
            if (!error) return false

            // Network errors
            if (axiosRetry.isNetworkError(error) || axiosRetry.isRetryableError(error)) {
                return true
            }

            // Rate limiting (429)
            if (error.response?.status === 429) {
                return true
            }

            // Server errors (5xx)
            const status = error.response?.status
            if (status && status >= 500 && status < 600) {
                return true
            }

            // Timeout errors
            if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                return true
            }

            return false
        },
        onRetry: (retryCount, error, requestConfig) => {
            const url = requestConfig.url || 'unknown'
            const status = error?.response?.status || error?.code || 'unknown'
            logger.debug(
                `Retrying API [${url}] due to error [${status}]. Retry number [${retryCount}/${retries ?? RETRIES}]`
            )

            // Only log error details at debug level to avoid spam
            if (logger.level === 'debug') {
                logger.debug(`Error details: ${error.message || error}`)
            }
        },
    }
}

/**
 * Creates an axios throttle configuration from the provided parameters
 * @param requestsPerSecond - Maximum number of requests per second (defaults to REQUESTSPERSECOND constant)
 * @returns Throttle configuration object
 */
export function createThrottleConfig(requestsPerSecond?: number) {
    const rps = requestsPerSecond ?? REQUESTSPERSECOND
    return {
        requestsPerSecond: rps,
        // Additional throttle options for better control
        maxConcurrentRequests: Math.max(10, rps * 2), // Allow some concurrency
        burstSize: Math.max(5, Math.floor(rps / 2)), // Allow small bursts
    }
}

// Legacy exports for backward compatibility
export const retriesConfig = createRetriesConfig()
export const throttleConfig = createThrottleConfig()
