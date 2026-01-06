import { FusionConfig, AttributeMap, AttributeDefinition } from '../model/config'
import { LogService } from './logService'
import { FusionAccount } from '../model/account'
import { SchemaService } from './schemaService'
import { Attributes } from '@sailpoint/connector-sdk'
import { evaluateVelocityTemplate, normalize, padNumber, removeSpaces, switchCase } from '../utils/formatting'
import { LockService } from './lockService'
import { RenderContext } from 'velocityjs/dist/src/type'
import { v4 as uuidv4 } from 'uuid'
import { assert } from '../utils/assert'

const uniqueAttributeTypes = ['unique', 'uuid', 'counter']

const isUniqueAttribute = (definition: AttributeDefinition): boolean => {
    return definition.type !== undefined && uniqueAttributeTypes.includes(definition.type)
}

/**
 * Wrapper for managing stateful counters across connector runs
 */
export class StateWrapper {
    state: Map<string, number> = new Map()
    private log?: LogService
    private locks?: LockService

    constructor(state?: any, log?: LogService, locks?: LockService) {
        this.log = log
        this.locks = locks
        if (log) {
            log.info(`Initializing StateWrapper with state: ${JSON.stringify(state)}`)
        }
        try {
            this.state = new Map(Object.entries(state || {}))
        } catch {
            if (log) {
                log.error('Failed to convert state object to Map. Initializing with empty Map')
            }
        }
    }

    /**
     * Set the lock service for thread-safe operations
     */
    setLockService(locks: LockService): void {
        this.locks = locks
    }

    /**
     * Get a non-persistent counter function (for unique attributes)
     */
    static getCounter(): () => number {
        let counter = 0
        return () => {
            counter++
            return counter
        }
    }

    /**
     * Get a persistent counter function (for counter-based attributes)
     * Returns an async function that uses locks for thread safety in parallel processing
     */
    getCounter(key: string, start: number = 1): () => Promise<number> {
        if (this.log) {
            this.log.debug(`Getting counter for key: ${key}`)
        }
        return async () => {
            const lockKey = `counter:${key}`

            if (this.locks) {
                // Use lock service for thread-safe counter increment
                return await this.locks.withLock(lockKey, async () => {
                    const currentValue = this.state.get(key) ?? start - 1
                    const nextValue = currentValue + 1
                    this.state.set(key, nextValue)
                    if (this.log) {
                        this.log.debug(`Persistent counter for key ${key} incremented to: ${nextValue}`)
                    }
                    return nextValue
                })
            } else {
                // Fallback to non-locked operation (not thread-safe)
                const currentValue = this.state.get(key) ?? start - 1
                const nextValue = currentValue + 1
                this.state.set(key, nextValue)
                if (this.log) {
                    this.log.debug(`Persistent counter for key ${key} incremented to: ${nextValue}`)
                }
                return nextValue
            }
        }
    }

    /**
     * Initialize a counter with a start value if it doesn't exist
     * Uses locks for thread safety in parallel processing
     */
    async initCounter(key: string, start: number): Promise<void> {
        const lockKey = `counter:${key}`

        if (this.locks) {
            await this.locks.withLock(lockKey, async () => {
                if (!this.state.has(key)) {
                    this.state.set(key, start)
                }
            })
        } else {
            // Fallback to non-locked operation (not thread-safe)
            if (!this.state.has(key)) {
                this.state.set(key, start)
            }
        }
    }

    /**
     * Get the state as a plain object for saving
     */
    getState(): { [key: string]: number } {
        return Object.fromEntries(this.state)
    }
}
/**
 * Split attribute value that may contain bracketed values like [value1] [value2]
 */
const attrSplit = (text: string): string[] => {
    const regex = /\[([^ ].+)\]/g
    const set = new Set<string>()

    let match = regex.exec(text)
    while (match) {
        set.add(match.pop() as string)
        match = regex.exec(text)
    }

    return set.size === 0 ? [text] : [...set]
}

/**
 * Concatenate array of strings into bracketed format: [value1] [value2]
 */
const attrConcat = (list: string[]): string => {
    const set = new Set(list)
    return [...set]
        .sort()
        .map((x) => `[${x}]`)
        .join(' ')
}

type AttributeMappingConfig = {
    attributeName: string
    sourceAttributes: string[] // Attributes to look for in source accounts
    attributeMerge: 'first' | 'list' | 'concatenate' | 'source'
    source?: string // Specific source to use (for 'source' merge strategy)
}

/**
 * Process a single attribute from source accounts based on processing configuration
 */
const processAttributeMapping = (
    config: AttributeMappingConfig,
    sourceAttributeMap: Map<string, Attributes[]>,
    sourceOrder: string[]
): any => {
    const { sourceAttributes, attributeMerge, source: specifiedSource } = config
    const multiValue: string[] = []

    // Process sources in established order
    for (const sourceName of sourceOrder) {
        const accounts = sourceAttributeMap.get(sourceName)
        if (!accounts || accounts.length === 0) {
            continue
        }

        // For 'source' merge strategy, only process the specified source
        if (attributeMerge === 'source' && specifiedSource && sourceName !== specifiedSource) {
            continue
        }

        // Process each Attributes object in the array for this source
        for (const account of accounts) {
            // Look for values in source attributes (in order of sourceAttributes array)
            const values: any[] = []
            for (const sourceAttr of sourceAttributes) {
                const value = account[sourceAttr]
                if (value !== undefined && value !== null && value !== '') {
                    values.push(value)
                    // For 'first' and 'source' strategies, stop after first match
                    if (['first', 'source'].includes(attributeMerge)) {
                        break
                    }
                }
            }

            if (values.length > 0) {
                // Split bracketed values
                const splitValues = values.map((x) => (typeof x === 'string' ? attrSplit(x) : [x])).flat()

                // Handle different merge strategies
                switch (attributeMerge) {
                    case 'first':
                        // Return first value from first source that has it
                        return splitValues[0]

                    case 'source':
                        if (specifiedSource === sourceName) {
                            // Return value from specified source
                            return splitValues[0]
                        }
                        break

                    case 'list':
                        // Collect values for later aggregation
                        multiValue.push(...splitValues)
                        break
                    case 'concatenate':
                        // Collect values for later aggregation
                        multiValue.push(...splitValues)
                        break
                }
            }
        }
    }

    // Apply multi-value merge strategies
    if (multiValue.length > 0) {
        const uniqueSorted = [...new Set(multiValue)].sort()
        if (attributeMerge === 'list') {
            return uniqueSorted
        } else if (attributeMerge === 'concatenate') {
            return attrConcat(uniqueSorted)
        }
    }

    return undefined
}

/**
 * Build processing configuration for an attribute by merging schema with attributeMaps
 */
const buildAttributeMappingConfig = (
    attributeName: string,
    attributeMaps: AttributeMap[] | undefined,
    defaultAttributeMerge: 'first' | 'list' | 'concatenate'
): AttributeMappingConfig => {
    // Check if attribute has specific configuration in attributeMaps
    const attributeMap = attributeMaps?.find((am) => am.newAttribute === attributeName)

    if (attributeMap) {
        // Use attributeMap configuration
        return {
            attributeName,
            sourceAttributes: attributeMap.existingAttributes || [attributeName],
            attributeMerge: attributeMap.attributeMerge || defaultAttributeMerge,
            source: attributeMap.source,
        }
    } else {
        // Use global attributeMerge policy with direct attribute name
        return {
            attributeName,
            sourceAttributes: [attributeName],
            attributeMerge: defaultAttributeMerge,
        }
    }
}

/**
 * Service for attribute mapping, attribute definition, and UUID management.
 * Combines functionality for mapping attributes from source accounts and generating unique IDs.
 */
export class AttributeService {
    private _attributeMappingConfig?: Map<string, AttributeMappingConfig>
    private _attributeDefinitionConfig: AttributeDefinition[] = []
    private _stateWrapper?: StateWrapper

    constructor(
        private config: FusionConfig,
        private schema: SchemaService,
        private log: LogService,
        private locks: LockService
    ) {
        // Clone attribute definitions into an internal array so we never touch
        // this.config.attributeDefinitions after construction, and always have a values Set.
        this._attributeDefinitionConfig =
            config.attributeDefinitions?.map((x) => ({
                ...x,
                values: new Set<string>(),
            })) ?? []
    }

    private get attributeDefinitionConfig(): AttributeDefinition[] {
        return this._attributeDefinitionConfig
    }

    private getAttributeDefinition(name: string): AttributeDefinition | undefined {
        return this._attributeDefinitionConfig.find((d) => d.name === name)
    }

    public hasAttributeDefinition(name: string): boolean {
        return this._attributeDefinitionConfig.find((d) => d.name === name) !== undefined
    }

    public addAttributeDefinition(definition: AttributeDefinition): void {
        this._attributeDefinitionConfig.push(definition)
    }

    /**
     * Set state wrapper for counter-based attributes
     * Injects lock service for thread-safe counter operations in parallel processing
     */
    public setStateWrapper(state: any): void {
        this._stateWrapper = new StateWrapper(state, this.log, this.locks)
    }

    private getStateWrapper(): StateWrapper {
        assert(this._stateWrapper, 'State wrapper is not set')
        return this._stateWrapper!
    }

    /**
     * Build Velocity context from FusionAccount's attributeBag
     * The context includes current attributes plus referenceable objects from attributeBag
     */
    private buildVelocityContext(fusionAccount: FusionAccount): { [key: string]: any } {
        // Start with current attributes - these are directly available in Velocity context
        const context: { [key: string]: any } = { ...fusionAccount.attributeBag.current }

        // Add referenceable objects from attributeBag
        context.identity = fusionAccount.attributeBag.identity
        context.accounts = fusionAccount.attributeBag.accounts
        context.previous = fusionAccount.attributeBag.previous
        context.sources = fusionAccount.attributeBag.sources

        return context
    }

    /**
     * Generate attribute value by evaluating the template expression
     */
    private generateAttributeValue(definition: AttributeDefinition, attributes: RenderContext): string | undefined {
        if (!definition.expression) {
            this.log.error(`Expression is required for attribute ${definition.name}`)
            return undefined
        }

        let value = evaluateVelocityTemplate(definition.expression, attributes, definition.maxLength, this.log)
        if (value) {
            this.log.debug(`Template evaluation result - attributeName: ${definition.name}, rawValue: ${value}`)

            if (definition.case) {
                value = switchCase(value, definition.case)
            }
            if (definition.spaces) {
                value = removeSpaces(value)
            }
            if (definition.normalize) {
                value = normalize(value)
            }
            this.log.debug(
                `Final attribute value after transformations - attributeName: ${definition.name}, finalValue: ${value}, transformations: case=${definition.case}, spaces=${definition.spaces}, normalize=${definition.normalize}`
            )
        } else {
            this.log.error(`Failed to evaluate velocity template for attribute ${definition.name}`)
            return undefined
        }

        return value
    }

    /**
     * Generate a normal attribute value from a definition
     */
    private async generateNormalAttribute(
        definition: AttributeDefinition,
        fusionAccount: FusionAccount
    ): Promise<string | undefined> {
        const context = this.buildVelocityContext(fusionAccount)
        return this.generateAttributeValue(definition, context)
    }

    /**
     * Generate a counter-based attribute value
     */
    private async generateCounterAttribute(
        definition: AttributeDefinition,
        fusionAccount: FusionAccount
    ): Promise<string | undefined> {
        const stateWrapper = this.getStateWrapper()
        const context = this.buildVelocityContext(fusionAccount)
        const counterStart = definition.counterStart ?? 1
        const counterFn = stateWrapper.getCounter(definition.name, counterStart)
        await stateWrapper.initCounter(definition.name, counterStart)
        const digits = definition.digits ?? 1
        const counterValue = await counterFn()
        context.counter = padNumber(counterValue, digits)

        // Counter attributes don't need uniqueness checking, just generate the value
        return this.generateAttributeValue(definition, context)
    }

    /**
     * Generate a unique attribute value with thread-safe generation and registration
     * The entire process (fetch values -> generate -> check -> register) is protected by a lock
     */
    private async generateUniqueAttribute(
        definition: AttributeDefinition,
        fusionAccount: FusionAccount
    ): Promise<string | undefined> {
        const context = this.buildVelocityContext(fusionAccount)
        const lockKey = `${definition.type}:${definition.name}`
        return await this.locks.withLock(lockKey, async () => {
            const registeredValues = definition.values!

            const counter = StateWrapper.getCounter()
            context.counter = ''

            let generatedValue: string | undefined
            let isUnique = false
            let attempts = 0
            const maxAttempts = 100 // Prevent infinite loops

            while (!isUnique && attempts < maxAttempts) {
                // Generate a candidate value - generateAttributeValue will check against registeredValues
                // to avoid generating values that already exist
                generatedValue = this.generateAttributeValue(definition, context)

                if (!generatedValue) {
                    break
                }

                // Check if this value is unique against the registered values
                // (generateAttributeValue already checked, but we verify again in case of race condition)
                if (!registeredValues.has(generatedValue)) {
                    // Value is unique - register it and return
                    registeredValues.add(generatedValue)
                    isUnique = true
                    this.log.debug(
                        `Generated and registered unique value for attribute ${definition.name}: ${generatedValue}`
                    )
                } else {
                    // Value already exists (shouldn't happen if generateAttributeValue worked correctly, but handle it)
                    attempts++
                    this.log.debug(
                        `Value ${generatedValue} already exists, regenerating for unique attribute: ${definition.name} (attempt ${attempts})`
                    )
                    const digits = definition.digits ?? 1
                    const counterValue = counter()
                    context.counter = padNumber(counterValue, digits)
                }
            }

            if (!isUnique) {
                this.log.error(
                    `Failed to generate unique value for attribute ${definition.name} after ${maxAttempts} attempts`
                )
                return undefined
            }

            return generatedValue
        })
    }

    /**
     * Generate a UUID attribute value with thread-safe generation and registration
     * UUIDs don't use counters - just keep generating new UUIDs until we find one that's unique
     * The entire process (fetch values -> generate -> check -> register) is protected by a lock
     */
    private async generateUUIDAttribute(definition: AttributeDefinition): Promise<string | undefined> {
        const lockKey = `${definition.type}:${definition.name}`
        return await this.locks.withLock(lockKey, async () => {
            const registeredValues = definition.values!

            let generatedValue: string | undefined
            let attempts = 0
            const maxAttempts = 100 // Prevent infinite loops (UUID collisions are extremely rare)

            // Keep generating UUIDs until we find one that's unique
            while (attempts < maxAttempts) {
                // Generate a new UUID - we check against registeredValues
                // and regenerate if it already exists
                generatedValue = uuidv4()

                if (!generatedValue) {
                    break
                }

                // Verify uniqueness and register atomically
                if (!registeredValues.has(generatedValue)) {
                    // Value is unique - register it and return
                    registeredValues.add(generatedValue)
                    this.log.debug(
                        `Generated and registered uuid value for attribute ${definition.name}: ${generatedValue}`
                    )
                    return generatedValue
                }

                // UUID collision detected (extremely rare) - regenerate
                attempts++
                this.log.debug(
                    `UUID collision detected for attribute ${definition.name}, regenerating (attempt ${attempts}): ${generatedValue}`
                )
            }

            this.log.error(
                `Failed to generate unique uuid value for attribute ${definition.name} after ${maxAttempts} attempts`
            )
            return undefined
        })
    }

    /**
     * Generate attribute value for a single attribute definition and update fusionAccount.attributeBag.current
     * For unique/uuid attributes, the entire generation process (fetch values, generate, check, register) is protected by a lock
     */
    private async generateAttribute(definition: AttributeDefinition, fusionAccount: FusionAccount): Promise<void> {
        // Only generate if refresh is needed and attribute doesn't exist
        if (!definition.refresh && fusionAccount.attributeBag.current[definition.name]) {
            return
        }

        let value: string | undefined

        switch (definition.type) {
            case 'counter':
                value = await this.generateCounterAttribute(definition, fusionAccount)
                break
            case 'unique':
                value = await this.generateUniqueAttribute(definition, fusionAccount)
                break
            case 'uuid':
                value = await this.generateUUIDAttribute(definition)
                break
            default:
                value = await this.generateNormalAttribute(definition, fusionAccount)
                break
        }

        // Update current attribute with the generated value
        if (value !== undefined) {
            fusionAccount.attributeBag.current[definition.name] = value
        }
    }

    private async _refreshAttributes(
        fusionAccount: FusionAccount,
        attributeDefinitions: AttributeDefinition[]
    ): Promise<void> {
        // Generate each attribute definition
        for (const definition of attributeDefinitions) {
            await this.generateAttribute(definition, fusionAccount)
        }
    }

    private get attributeMappingConfig(): Map<string, AttributeMappingConfig> {
        if (!this._attributeMappingConfig) {
            this._attributeMappingConfig = new Map()
            const schemaAttributes = this.schema.getSchemaAttributes()
            for (const schemaAttr of schemaAttributes) {
                const attrName = schemaAttr.name!
                this._attributeMappingConfig.set(
                    attrName,
                    buildAttributeMappingConfig(attrName, this.config.attributeMaps, this.config.attributeMerge)
                )
            }
        }
        return this._attributeMappingConfig
    }

    /**
     * Map attributes from source accounts to fusion account
     * Processes _sourceAttributeMap in established source order if refresh is needed,
     * using _previousAttributes as default.
     * Uses schema attributes merged with attributeMaps to determine processing configuration.
     */
    public mapAttributes(fusionAccount: FusionAccount): void {
        const attributeBag = fusionAccount.attributeBag
        const needsRefresh = fusionAccount.needsRefresh

        // Start with previous attributes as default
        const attributes = { ...attributeBag.previous }

        const sourceAttributeMap =
            fusionAccount.type === 'identity' ? new Map([['identity', [attributeBag.identity]]]) : attributeBag.sources
        const sourceOrder = fusionAccount.type === 'identity' ? ['identity'] : this.config.sources

        // If refresh is needed, process source attributes in established order
        if (needsRefresh && sourceAttributeMap.size > 0) {
            const schemaAttributes = this.schema.getSchemaAttributes()
            // Process each schema attribute
            for (const attribute of schemaAttributes) {
                const name = attribute.name!

                // Build processing configuration (merges schema with attributeMaps)
                const processingConfig = this.attributeMappingConfig.get(name)!

                // Process the attribute based on its configuration
                const processedValue = processAttributeMapping(processingConfig, sourceAttributeMap, sourceOrder)

                // Set the processed value if found
                if (processedValue !== undefined) {
                    attributes[name] = processedValue
                }
            }

            // Build sources string
            const sourceNames = Array.from(attributeBag.sources.keys())
            if (sourceNames.length > 0) {
                attributes.sources = sourceNames.map((x) => `[${x}]`).join(' ')
            }
        }

        // Set the mapped attributes
        attributeBag.current = attributes
    }

    public async refreshNonUniqueAttributes(fusionAccount: FusionAccount): Promise<void> {
        if (!fusionAccount.needsRefresh) return
        this.log.debug(
            `Refreshing non-unique attributes for account: ${fusionAccount.name} (${fusionAccount.sourceName})`
        )

        // Process attributes (no values map needed for non-unique attributes)
        const allDefinitions = this._attributeDefinitionConfig
        const nonUniqueAttributeDefinitions = allDefinitions.filter((x) => !isUniqueAttribute(x))

        await this._refreshAttributes(fusionAccount, nonUniqueAttributeDefinitions)
    }

    public async refreshUniqueAttributes(fusionAccount: FusionAccount): Promise<void> {
        if (!fusionAccount.needsRefresh) return
        this.log.debug(`Refreshing unique attributes for account: ${fusionAccount.name} (${fusionAccount.sourceName})`)

        const allDefinitions = this._attributeDefinitionConfig
        const uniqueAttributeDefinitions = allDefinitions.filter(isUniqueAttribute)

        await this._refreshAttributes(fusionAccount, uniqueAttributeDefinitions)
    }

    public async refreshAttributes(fusionAccount: FusionAccount): Promise<void> {
        const allDefinitions = this._attributeDefinitionConfig
        await this._refreshAttributes(fusionAccount, allDefinitions)
    }

    public async registerUniqueAttributes(fusionAccount: FusionAccount): Promise<void> {
        this.log.debug(`Registering unique attributes for account: ${fusionAccount.nativeIdentity}`)

        const attributeDefinitions = this._attributeDefinitionConfig
        const uniqueDefinitions = attributeDefinitions.filter((def) => def.type === 'unique' || def.type === 'uuid')

        for (const def of uniqueDefinitions) {
            const value = fusionAccount.attributeBag.current[def.name]
            if (value !== undefined && value !== null && value !== '') {
                const valueStr = String(value)
                const lockKey = `${def.type}:${def.name}`
                await this.locks.withLock(lockKey, async () => {
                    const defConfig = this.getAttributeDefinition(def.name)
                    assert(defConfig, `Attribute ${def.name} not found in attribute definition config`)
                    defConfig.values!.add(valueStr)
                })
            }
        }
    }
}
