import { logger } from '@sailpoint/connector-sdk'
import axiosRetry from 'axios-retry'

/**
 * Priority levels for queue items
 */
export enum QueuePriority {
    LOW = 0,
    NORMAL = 1,
    HIGH = 2,
    URGENT = 3,
}

/**
 * Queue item interface
 */
export interface QueueItem<T = any> {
    id: string
    priority: QueuePriority
    execute: () => Promise<T>
    resolve: (value: T) => void
    reject: (error: any) => void
    retryCount: number
    maxRetries: number
    createdAt: number
}

/**
 * Queue statistics
 */
export interface QueueStats {
    totalProcessed: number
    totalFailed: number
    totalRetries: number
    averageWaitTime: number
    averageProcessingTime: number
    queueLength: number
    activeRequests: number
}

/**
 * Configuration for the API queue
 */
export interface QueueConfig {
    requestsPerSecond: number
    maxConcurrentRequests: number
    maxRetries: number
}

/**
 * Advanced API call queue manager with throttling, retry, and concurrency control.
 * Note: Pagination is handled at the ClientService level, not in the queue.
 */
export class ApiQueue {
    private queue: QueueItem[] = []
    private activeRequests: number = 0
    private processing: boolean = false
    private stats: QueueStats = {
        totalProcessed: 0,
        totalFailed: 0,
        totalRetries: 0,
        averageWaitTime: 0,
        averageProcessingTime: 0,
        queueLength: 0,
        activeRequests: 0,
    }
    private waitTimes: number[] = []
    private processingTimes: number[] = []
    private lastRequestTime: number = 0
    private minRequestInterval: number

    constructor(private config: QueueConfig) {
        this.minRequestInterval = 1000 / config.requestsPerSecond
        this.startProcessing()
    }

    /**
     * Add a request to the queue
     */
    async enqueue<T>(
        execute: () => Promise<T>,
        options: {
            priority?: QueuePriority
            maxRetries?: number
            id?: string
        } = {}
    ): Promise<T> {
        const item: QueueItem<T> = {
            id: options.id || `req-${Date.now()}-${Math.random()}`,
            priority: options.priority ?? QueuePriority.NORMAL,
            execute,
            resolve: () => {},
            reject: () => {},
            retryCount: 0,
            maxRetries: options.maxRetries ?? this.config.maxRetries,
            createdAt: Date.now(),
        }

        return new Promise<T>((resolve, reject) => {
            item.resolve = resolve
            item.reject = reject

            // Insert based on priority (higher priority first)
            const insertIndex = this.queue.findIndex((q) => q.priority < item.priority)
            if (insertIndex === -1) {
                this.queue.push(item)
            } else {
                this.queue.splice(insertIndex, 0, item)
            }

            this.stats.queueLength = this.queue.length

            // Process immediately if not at capacity
            this.processQueue()
        })
    }

    /**
     * Start the queue processing loop
     */
    private startProcessing(): void {
        if (this.processing) return
        this.processing = true
        this.processQueue()
    }

    /**
     * Process the queue
     * Each request is executed individually, respecting concurrency and throttling limits.
     * Pagination is handled at the ClientService level, not here.
     */
    private async processQueue(): Promise<void> {
        if (!this.processing) return

        // Process requests up to the concurrency limit
        while (this.queue.length > 0 && this.activeRequests < this.config.maxConcurrentRequests) {
            const item = this.queue.shift()!
            this.stats.queueLength = this.queue.length

            // Execute the request immediately (it will handle its own throttling)
            // Don't await - let multiple requests run concurrently up to maxConcurrentRequests
            this.executeRequest(item).catch(() => {
                // Error already handled in executeRequest
            })
        }

        // Continue processing if there are items in queue and capacity available
        if (this.queue.length > 0 && this.activeRequests < this.config.maxConcurrentRequests) {
            setTimeout(() => this.processQueue(), 10)
        }
    }

    /**
     * Execute a single request with throttling and retry
     */
    private async executeRequest<T>(item: QueueItem<T>): Promise<void> {
        this.activeRequests++
        this.stats.activeRequests = this.activeRequests

        const waitTime = Date.now() - item.createdAt
        this.waitTimes.push(waitTime)
        if (this.waitTimes.length > 1000) {
            this.waitTimes.shift()
        }

        // Throttle: ensure minimum time between requests
        const timeSinceLastRequest = Date.now() - this.lastRequestTime
        if (timeSinceLastRequest < this.minRequestInterval) {
            await this.sleep(this.minRequestInterval - timeSinceLastRequest)
        }

        const startTime = Date.now()
        this.lastRequestTime = Date.now()

        try {
            const result = await item.execute()
            const processingTime = Date.now() - startTime
            this.processingTimes.push(processingTime)
            if (this.processingTimes.length > 1000) {
                this.processingTimes.shift()
            }

            this.stats.totalProcessed++
            this.updateStats()
            item.resolve(result)
        } catch (error: any) {
            const processingTime = Date.now() - startTime
            this.processingTimes.push(processingTime)
            if (this.processingTimes.length > 1000) {
                this.processingTimes.shift()
            }

            // Check if we should retry
            if (this.shouldRetry(error) && item.retryCount < item.maxRetries) {
                item.retryCount++
                this.stats.totalRetries++
                this.updateStats()

                const delay = this.calculateRetryDelay(item.retryCount, error)
                logger.debug(
                    `Retrying request [${item.id}] (attempt ${item.retryCount}/${item.maxRetries}) after ${delay}ms`
                )

                await this.sleep(delay)

                // Re-queue with same priority (priority is always enabled)
                const insertIndex = this.queue.findIndex((q) => q.priority < item.priority)
                if (insertIndex === -1) {
                    this.queue.push(item)
                } else {
                    this.queue.splice(insertIndex, 0, item)
                }
                this.stats.queueLength = this.queue.length
            } else {
                this.stats.totalFailed++
                this.updateStats()
                item.reject(error)
            }
        } finally {
            this.activeRequests--
            this.stats.activeRequests = this.activeRequests

            // Continue processing
            setTimeout(() => this.processQueue(), 0)
        }
    }

    /**
     * Determine if an error should trigger a retry
     */
    private shouldRetry(error: any): boolean {
        if (!error) return false

        // Network errors
        if (axiosRetry.isNetworkError(error) || axiosRetry.isRetryableError(error)) {
            return true
        }

        // Rate limiting
        if (error.response?.status === 429) {
            return true
        }

        // Server errors (5xx)
        if (error.response?.status >= 500 && error.response?.status < 600) {
            return true
        }

        // Timeout errors
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            return true
        }

        return false
    }

    /**
     * Calculate retry delay with exponential backoff and respect for retry-after headers.
     * For 429 responses, uses the retry-after header with jitter.
     * For other retryable errors, uses exponential backoff with a sensible base delay.
     */
    private calculateRetryDelay(retryCount: number, error: any): number {
        // If 429, check for retry-after header and add jitter
        if (error.response?.status === 429) {
            const retryAfter = error.response.headers['retry-after']
            if (retryAfter) {
                const delay = parseInt(retryAfter, 10)
                if (!isNaN(delay)) {
                    const baseDelay = delay * 1000 // Convert to milliseconds
                    // Add up to 10% jitter to prevent thundering herd
                    const jitter = Math.random() * 0.1 * baseDelay
                    return baseDelay + jitter
                }
            }
        }

        // Exponential backoff for other retryable errors: baseDelay * 2^retryCount, with jitter
        const baseDelay = 1000 // 1 second base delay (sensible default)
        const exponentialDelay = baseDelay * Math.pow(2, retryCount - 1)
        const jitter = Math.random() * 0.3 * exponentialDelay // Add up to 30% jitter
        const maxDelay = 60000 // Cap at 60 seconds

        return Math.min(exponentialDelay + jitter, maxDelay)
    }

    /**
     * Get current queue statistics
     */
    getStats(): QueueStats {
        return { ...this.stats }
    }

    /**
     * Update statistics
     */
    private updateStats(): void {
        if (this.waitTimes.length > 0) {
            this.stats.averageWaitTime = this.waitTimes.reduce((a, b) => a + b, 0) / this.waitTimes.length
        }
        if (this.processingTimes.length > 0) {
            this.stats.averageProcessingTime =
                this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
        }
    }

    /**
     * Clear the queue
     */
    clear(): void {
        this.queue.forEach((item) => {
            item.reject(new Error('Queue cleared'))
        })
        this.queue = []
        this.stats.queueLength = 0
    }

    /**
     * Stop processing
     */
    stop(): void {
        this.processing = false
    }

    /**
     * Sleep utility
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }
}
