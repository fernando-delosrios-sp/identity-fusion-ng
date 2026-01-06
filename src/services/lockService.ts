import { LogService } from './logService'

export interface LockService {
    withLock<T>(key: string, fn: () => Promise<T>): Promise<T>
}

export class InMemoryLockService implements LockService {
    private queues = new Map<string, Promise<unknown>>()

    constructor(private log: LogService) {}

    async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
        this.log.debug(`Acquiring lock for key: ${key}`)

        // Get the promise for the last task on this key, or an already-resolved one
        const prev = this.queues.get(key) || Promise.resolve()

        // Create a new promise that represents this task
        let resolveNext: (value: unknown) => void
        const next = new Promise((r) => {
            resolveNext = r
        })

        // Chain this task after the previous one
        this.queues.set(key, next)

        // Wait for previous task on this key to finish
        await prev

        this.log.debug(`Lock acquired for key: ${key}`)

        try {
            // Run the critical section
            const result = await fn()
            this.log.debug(`Lock released for key (success): ${key}`)
            return result
        } catch (error) {
            this.log.error?.(`Error in lock-protected function for key "${key}": ${(error as Error).message}`)
            throw error
        } finally {
            // Mark this task as done so the next waiter can start
            resolveNext!(undefined)

            // If no one else replaced this queue entry, clean it up
            if (this.queues.get(key) === next) {
                this.queues.delete(key)
                this.log.debug(`Cleaned up lock queue for key: ${key}`)
            }
        }
    }
}
