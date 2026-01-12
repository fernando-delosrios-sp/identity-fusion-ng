import { FusionConfig, AttributeMap, AttributeDefinition, SourceConfig } from '../model/config'
import { LogService } from './logService'
import { FusionAccount } from '../model/account'
import { SchemaService } from './schemaService'
import { Attributes, CompoundKey, CompoundKeyType, SimpleKey, SimpleKeyType } from '@sailpoint/connector-sdk'
import { evaluateVelocityTemplate, normalize, padNumber, removeSpaces, switchCase } from '../utils/formatting'
import { LockService } from './lockService'
import { RenderContext } from 'velocityjs/dist/src/type'
import { v4 as uuidv4 } from 'uuid'
import { assert } from '../utils/assert'
import { SourcesApiUpdateSourceRequest } from 'sailpoint-api-client'
import { SourceService } from './sourceService'

// ============================================================================
// Constants
// ============================================================================

const uniqueAttributeTypes = ['unique', 'uuid', 'counter']
export const compoundKeyUniqueIdAttribute = 'CompoundKey.uniqueId'
const fusionStateConfigPath = '/connectorAttributes/fusionState'

// ============================================================================
// Type Definitions
// ============================================================================

type AttributeMappingConfig = {
    attributeName: string
    sourceAttributes: string[] // Attributes to look for in source accounts
    attributeMerge: 'first' | 'list' | 'concatenate' | 'source'
    source?: string // Specific source to use (for 'source' merge strategy)
}

// ============================================================================
// Helper Functions
// ============================================================================

const isUniqueAttribute = (definition: AttributeDefinition): boolean => {
    return definition.type !== undefined && uniqueAttributeTypes.includes(definition.type)
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
export const attrConcat = (list: string[]): string => {
    const set = new Set(list)
    return [...set]
        .sort()
        .map((x) => `[${x}]`)
        .join(' ')
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

// ============================================================================
// StateWrapper Class
// ============================================================================

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
            // Handle undefined, null, or empty state
            if (state && typeof state === 'object' && Object.keys(state).length > 0) {
                this.state = new Map(Object.entries(state))
                if (log) {
                    log.debug(`Loaded ${this.state.size} counter values from state`)
                }
            } else {
                this.state = new Map()
                if (log) {
                    log.debug('Initializing with empty state (no previous counter values)')
                }
            }
        } catch (error) {
            if (log) {
                log.error(`Failed to convert state object to Map: ${error}. Initializing with empty Map`)
            }
            this.state = new Map()
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
     * Counters must be initialized via initializeCounters() before use
     */
    getCounter(key: string): () => Promise<number> {
        if (this.log) {
            this.log.debug(`Getting counter for key: ${key}`)
        }
        return async () => {
            const lockKey = `counter:${key}`

            return await this.locks!.withLock(lockKey, async () => {
                // Ensure counter exists (should have been initialized, but check for safety)
                if (!this.state.has(key)) {
                    const error = new Error(`Counter ${key} was not initialized. Call initializeCounters() first.`)
                    if (this.log) {
                        this.log.error(error.message)
                    }
                    throw error
                }

                const currentValue = this.state.get(key)!
                const nextValue = currentValue + 1
                this.state.set(key, nextValue)
                // Verify the state was actually updated
                const verifyValue = this.state.get(key)
                if (verifyValue !== nextValue) {
                    throw new Error(
                        `State update failed! Set ${key} to ${nextValue} but got ${verifyValue} when reading back`
                    )
                }
                if (this.log) {
                    this.log.debug(
                        `Persistent counter for key ${key} incremented from ${currentValue} to: ${nextValue} (verified: ${verifyValue})`
                    )
                }
                return nextValue
            })
        }
    }

    /**
     * Initialize a counter with a start value if it doesn't exist
     * Sets the counter to (start - 1) so that the first increment returns 'start'
     * Uses locks for thread safety in parallel processing
     */
    async initCounter(key: string, start: number): Promise<void> {
        const lockKey = `counter:${key}`

        if (this.locks) {
            await this.locks.withLock(lockKey, async () => {
                if (!this.state.has(key)) {
                    // Set to start - 1 so first increment returns 'start'
                    this.state.set(key, start - 1)
                    if (this.log) {
                        this.log.debug(`Initialized counter ${key} to ${start - 1} (first value will be ${start})`)
                    }
                }
            })
        } else {
            // Fallback to non-locked operation (not thread-safe)
            if (!this.state.has(key)) {
                // Set to start - 1 so first increment returns 'start'
                this.state.set(key, start - 1)
                if (this.log) {
                    this.log.debug(`Initialized counter ${key} to ${start - 1} (first value will be ${start})`)
                }
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

// ============================================================================
// AttributeService Class
// ============================================================================

/**
 * Service for attribute mapping, attribute definition, and UUID management.
 * Combines functionality for mapping attributes from source accounts and generating unique IDs.
 */
export class AttributeService {
    private _attributeMappingConfig?: Map<string, AttributeMappingConfig>
    private _attributeDefinitionConfig: AttributeDefinition[] = []
    private _stateWrapper?: StateWrapper
    private readonly attributeMaps?: AttributeMap[]
    private readonly attributeMerge: 'first' | 'list' | 'concatenate'
    private readonly sourceConfigs: SourceConfig[]
    private readonly maxAttempts?: number

    // ------------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------------

    constructor(
        config: FusionConfig,
        private schemas: SchemaService,
        private sourceService: SourceService,
        private log: LogService,
        private locks: LockService
    ) {
        this.attributeMaps = config.attributeMaps
        this.attributeMerge = config.attributeMerge
        this.sourceConfigs = config.sources
        this.maxAttempts = config.maxAttempts
        // Clone attribute definitions into an internal array so we never touch
        // config.attributeDefinitions after construction, and always have a values Set.
        this._attributeDefinitionConfig =
            config.attributeDefinitions?.map((x) => ({
                ...x,
                values: new Set<string>(),
            })) ?? []

        this.setStateWrapper(config.fusionState)
    }

    // ------------------------------------------------------------------------
    // Public State Management Methods
    // ------------------------------------------------------------------------

    /**
     * Save the current state to the source configuration
     */
    public async saveState(): Promise<void> {
        const fusionSourceId = this.sourceService.fusionSourceId
        const stateObject = await this.getStateObject()

        this.log.info(`Saving state object: ${JSON.stringify(stateObject)}`)
        const requestParameters: SourcesApiUpdateSourceRequest = {
            id: fusionSourceId,
            jsonPatchOperation: [
                {
                    op: 'add',
                    path: fusionStateConfigPath,
                    value: stateObject,
                },
            ],
        }
        await this.sourceService.patchSourceConfig(fusionSourceId, requestParameters)
    }

    /**
     * Get the current state object
     */
    public async getStateObject(): Promise<{ [key: string]: number }> {
        // Wait for all pending counter increments to complete before reading state
        if (this.locks && typeof this.locks.waitForAllPendingOperations === 'function') {
            await this.locks.waitForAllPendingOperations()
        }
        const stateWrapper = this.getStateWrapper()

        // Debug: Log the state map directly before converting
        if (this.log) {
            const directStateEntries = Array.from(stateWrapper.state.entries())
            this.log.debug(
                `Reading state - StateWrapper has ${stateWrapper.state.size} entries: ${JSON.stringify(Object.fromEntries(directStateEntries))}`
            )
        }

        const state = stateWrapper.getState()

        // Debug: Log what getState() returns
        if (this.log) {
            this.log.debug(`getState() returned: ${JSON.stringify(state)}`)
            // Verify they match
            const directState = Object.fromEntries(stateWrapper.state.entries())
            if (JSON.stringify(state) !== JSON.stringify(directState)) {
                this.log.error(
                    `State mismatch! getState()=${JSON.stringify(state)}, direct=${JSON.stringify(directState)}`
                )
            }
        }

        return state
    }

    /**
     * Set state wrapper for counter-based attributes
     * Injects lock service for thread-safe counter operations in parallel processing
     */
    public setStateWrapper(state: any): void {
        this._stateWrapper = new StateWrapper(state, this.log, this.locks)
    }

    /**
     * Initialize all counter-based attributes from configuration
     * Should be called once after setStateWrapper to ensure all counters are initialized
     */
    public async initializeCounters(): Promise<void> {
        const stateWrapper = this.getStateWrapper()
        const counterDefinitions = this._attributeDefinitionConfig.filter((def) => def.type === 'counter')

        if (counterDefinitions.length === 0) {
            return
        }

        if (this.log) {
            this.log.debug(`Initializing ${counterDefinitions.length} counter-based attributes`)
            // Log existing counter values before initialization
            const existingCounters = Object.fromEntries(
                Array.from(stateWrapper.state.entries()).filter(([key]) =>
                    counterDefinitions.some((def) => def.name === key)
                )
            )
            if (Object.keys(existingCounters).length > 0) {
                this.log.debug(`Preserving existing counter values: ${JSON.stringify(existingCounters)}`)
            }
        }

        // Initialize all counters in parallel (each initCounter handles its own locking)
        await Promise.all(
            counterDefinitions.map((def) => {
                const start = def.counterStart ?? 1
                return stateWrapper.initCounter(def.name, start)
            })
        )

        if (this.log) {
            // Log final counter values after initialization
            const finalCounters: { [key: string]: number } = {}
            counterDefinitions.forEach((def) => {
                const value = stateWrapper.state.get(def.name)
                if (value !== undefined) {
                    finalCounters[def.name] = value
                }
            })
            this.log.debug(`All counter-based attributes initialized. Current values: ${JSON.stringify(finalCounters)}`)
        }
    }

    // ------------------------------------------------------------------------
    // Public Attribute Mapping Methods
    // ------------------------------------------------------------------------

    /**
     * Map attributes from source accounts to fusion account
     * Processes _sourceAttributeMap in established source order if refresh is needed,
     * using _previousAttributes as default.
     * Uses schema attributes merged with attributeMaps to determine processing configuration.
     */
    public mapAttributes(fusionAccount: FusionAccount): void {
        const { attributeBag, needsRefresh } = fusionAccount

        // Start with previous attributes as default
        const attributes = { ...attributeBag.previous }

        const sourceAttributeMap = new Map(attributeBag.sources.entries())
        if (fusionAccount.type === 'identity') {
            sourceAttributeMap.set('identity', [attributeBag.identity])
        }
        const sourceOrder =
            fusionAccount.type === 'identity'
                ? [...this.sourceConfigs.map((sc) => sc.name), 'identity']
                : this.sourceConfigs.map((sc) => sc.name)

        // If refresh is needed, process source attributes in established order
        if (needsRefresh && sourceAttributeMap.size > 0) {
            const schemaAttributes = this.schemas.listSchemaAttributeNames()
            // Process each schema attribute
            for (const attribute of schemaAttributes) {
                // Check if there's an attribute definition with overwrite: true
                const definition = this._attributeDefinitionConfig.find((def) => def.name === attribute)
                // If overwrite is true, skip mapping from source accounts - generated value will overwrite it
                if (definition?.overwrite) {
                    continue
                }

                // Build processing configuration (merges schema with attributeMaps)
                const processingConfig = this.attributeMappingConfig.get(attribute)!

                // Process the attribute based on its configuration
                const processedValue = processAttributeMapping(processingConfig, sourceAttributeMap, sourceOrder)

                // Set the processed value if found
                if (processedValue !== undefined) {
                    attributes[attribute] = processedValue
                }
            }
        }

        // Set the mapped attributes
        attributeBag.current = attributes
    }

    // ------------------------------------------------------------------------
    // Public Attribute Refresh Methods
    // ------------------------------------------------------------------------

    /**
     * Refresh all attributes for a fusion account
     */
    public async refreshAttributes(fusionAccount: FusionAccount): Promise<void> {
        const allDefinitions = this._attributeDefinitionConfig
        await this._refreshAttributes(fusionAccount, allDefinitions)
    }

    /**
     * Refresh non-unique attributes for a fusion account
     */
    public async refreshNonUniqueAttributes(fusionAccount: FusionAccount): Promise<void> {
        if (!fusionAccount.needsRefresh) return
        this.log.debug(
            `Refreshing non-unique attributes for account: ${fusionAccount.name} (${fusionAccount.sourceName})`
        )

        const allDefinitions = this._attributeDefinitionConfig
        const nonUniqueAttributeDefinitions = allDefinitions.filter((x) => !isUniqueAttribute(x))

        await this._refreshAttributes(fusionAccount, nonUniqueAttributeDefinitions)
    }

    /**
     * Refresh unique attributes for a fusion account
     */
    public async refreshUniqueAttributes(fusionAccount: FusionAccount): Promise<void> {
        if (!fusionAccount.needsRefresh) return
        this.log.debug(`Refreshing unique attributes for account: ${fusionAccount.name} (${fusionAccount.sourceName})`)

        const allDefinitions = this._attributeDefinitionConfig
        const uniqueAttributeDefinitions = allDefinitions.filter(isUniqueAttribute)

        await this._refreshAttributes(fusionAccount, uniqueAttributeDefinitions)
    }

    /**
     * Register unique attribute values for a fusion account
     */
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

    // ------------------------------------------------------------------------
    // Public Key Generation Methods
    // ------------------------------------------------------------------------

    /**
     * Generate a simple key for a fusion account
     */
    public getSimpleKey(fusionAccount: FusionAccount): SimpleKeyType {
        const { fusionIdentityAttribute } = this.schemas
        const uniqueId = fusionAccount.nativeIdentity ?? (fusionAccount.attributes[fusionIdentityAttribute] as string)
        assert(uniqueId, `Unique ID is required for simple key`)

        return SimpleKey(uniqueId)
    }

    /**
     * Generate a compound key for a fusion account
     */
    public getCompoundKey(fusionAccount: FusionAccount): CompoundKeyType {
        const { fusionDisplayAttribute } = this.schemas

        const uniqueId = fusionAccount.attributes[compoundKeyUniqueIdAttribute] as string
        assert(uniqueId, `Unique ID is required for compound key`)
        const lookupId = (fusionAccount.attributes[fusionDisplayAttribute] as string) ?? uniqueId

        return CompoundKey(lookupId, uniqueId)
    }

    // ------------------------------------------------------------------------
    // Private Configuration Helper Methods
    // ------------------------------------------------------------------------

    private get attributeMappingConfig(): Map<string, AttributeMappingConfig> {
        if (!this._attributeMappingConfig) {
            this._attributeMappingConfig = new Map()
            const schemaAttributes = this.schemas.getSchemaAttributes()
            for (const schemaAttr of schemaAttributes) {
                const attrName = schemaAttr.name!
                this._attributeMappingConfig.set(
                    attrName,
                    buildAttributeMappingConfig(attrName, this.attributeMaps, this.attributeMerge)
                )
            }
        }
        return this._attributeMappingConfig
    }

    private getAttributeDefinition(name: string): AttributeDefinition | undefined {
        return this._attributeDefinitionConfig.find((d) => d.name === name)
    }

    private getStateWrapper(): StateWrapper {
        assert(this._stateWrapper, 'State wrapper is not set')
        return this._stateWrapper!
    }

    // ------------------------------------------------------------------------
    // Private Context Builder Methods
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // Private Attribute Generation Methods
    // ------------------------------------------------------------------------

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
     * Counters are initialized in accountList via initializeCounters() before use
     */
    private async generateCounterAttribute(
        definition: AttributeDefinition,
        fusionAccount: FusionAccount
    ): Promise<string | undefined> {
        const stateWrapper = this.getStateWrapper()
        const context = this.buildVelocityContext(fusionAccount)
        const counterFn = stateWrapper.getCounter(definition.name)
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
            const maxAttempts = this.maxAttempts ?? 100 // Prevent infinite loops

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
            const maxAttempts = this.maxAttempts ?? 100 // Prevent infinite loops (UUID collisions are extremely rare)

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

    // ------------------------------------------------------------------------
    // Private Attribute Generation Orchestration
    // ------------------------------------------------------------------------

    /**
     * Generate attribute value for a single attribute definition and update fusionAccount.attributeBag.current
     * For unique/uuid attributes, the entire generation process (fetch values, generate, check, register) is protected by a lock
     */
    private async generateAttribute(definition: AttributeDefinition, fusionAccount: FusionAccount): Promise<void> {
        // Counter attributes always generate (they maintain state across runs)
        if (definition.type === 'counter') {
            // Continue to generation logic below
        }
        // If overwrite is true, always generate (to overwrite existing values)
        else if (definition.overwrite) {
            // Continue to generation logic below
        }
        // If overwrite is false, check if we should skip generation
        else {
            // For normal attributes: don't generate if refresh is not needed and the attribute already exists
            if (!definition.refresh && !isUniqueAttribute(definition) && fusionAccount.attributes[definition.name]) {
                return
            }

            // For unique/uuid attributes: don't generate if the attribute already exists
            if (isUniqueAttribute(definition) && fusionAccount.attributes[definition.name]) {
                return
            }
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

    /**
     * Refresh attributes for a fusion account based on the provided definitions
     */
    private async _refreshAttributes(
        fusionAccount: FusionAccount,
        attributeDefinitions: AttributeDefinition[]
    ): Promise<void> {
        // Generate each attribute definition
        for (const definition of attributeDefinitions) {
            await this.generateAttribute(definition, fusionAccount)
        }
    }
}
