/**
 * Type-safe indexed collection that maintains multiple indexes for efficient lookups
 */
type IndexKey<T> = keyof T & string

export class IndexedCollection<T extends Record<string, any>> {
    private items = new Map<string, T>()
    private indexes = new Map<IndexKey<T>, Map<any, Set<T>>>()

    constructor(
        private primaryKey: IndexKey<T>,
        private indexKeys: IndexKey<T>[]
    ) {
        // Initialize indexes
        for (const key of indexKeys) {
            this.indexes.set(key, new Map())
        }
    }

    /**
     * Add an item to the collection
     */
    add(item: T): void {
        const pk = item[this.primaryKey]
        if (typeof pk !== 'string') {
            throw new Error(`Primary key must be a string, got ${typeof pk}`)
        }

        // Remove old item if exists (to update indexes)
        this.remove(pk)

        // Add to primary index
        this.items.set(pk, item)

        // Add to all secondary indexes
        for (const indexKey of this.indexKeys) {
            const index = this.indexes.get(indexKey)!
            const value = item[indexKey]

            // Handle arrays (multi-value index)
            const values = Array.isArray(value) ? value : [value]
            for (const v of values as any[]) {
                if (v !== null && v !== undefined) {
                    if (!index.has(v)) {
                        index.set(v, new Set())
                    }
                    index.get(v)!.add(item)
                }
            }
        }
    }

    /**
     * Get an item by primary key
     */
    get(primaryKey: string): T | undefined {
        return this.items.get(primaryKey)
    }

    /**
     * Find items by an indexed field
     */
    findBy<K extends IndexKey<T>>(indexKey: K, value: T[K]): T[] {
        const index = this.indexes.get(indexKey)
        if (!index) return []
        const set = index.get(value)
        return set ? Array.from(set) : []
    }

    /**
     * Check if an item exists by primary key
     */
    has(primaryKey: string): boolean {
        return this.items.has(primaryKey)
    }

    /**
     * Remove an item by primary key
     */
    remove(primaryKey: string): boolean {
        const item = this.items.get(primaryKey)
        if (!item) return false

        this.items.delete(primaryKey)

        // Remove from all indexes
        for (const indexKey of this.indexKeys) {
            const index = this.indexes.get(indexKey)!
            const value = item[indexKey]
            const values = Array.isArray(value) ? value : [value]

            for (const v of values as any[]) {
                if (v !== null && v !== undefined) {
                    const set = index.get(v)
                    if (set) {
                        set.delete(item)
                        if (set.size === 0) {
                            index.delete(v)
                        }
                    }
                }
            }
        }

        return true
    }

    /**
     * Clear all items and indexes
     */
    clear(): void {
        this.items.clear()
        for (const index of this.indexes.values()) {
            index.clear()
        }
    }

    /**
     * Get all items
     */
    getAll(): T[] {
        return Array.from(this.items.values())
    }

    /**
     * Get the size of the collection
     */
    size(): number {
        return this.items.size
    }

    /**
     * Iterate over all items
     */
    forEach(callback: (item: T, primaryKey: string) => void): void {
        this.items.forEach((item, key) => callback(item, key))
    }

    /**
     * Get all primary keys
     */
    keys(): string[] {
        return Array.from(this.items.keys())
    }

    /**
     * Get all values
     */
    values(): T[] {
        return Array.from(this.items.values())
    }
}
