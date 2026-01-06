import { SourceManagementWorkgroup } from 'sailpoint-api-client'

export interface BaseConfig {
    beforeProvisioningRule: string | null
    cloudCacheUpdate: number
    cloudDisplayName: string
    cloudExternalId: string
    commandType: string
    connectionType: string
    connectorName: string
    deleteThresholdPercentage: number
    deleteEmpty: boolean
    formPath: string | null
    healthy: boolean
    idnProxyType: string
    invocationId: string
    managementWorkgroup: SourceManagementWorkgroup | null
    since: string
    sourceDescription: string
    spConnectorInstanceId: string
    spConnectorSpecId: string
    spConnectorSupportsCustomSchemas: boolean
    status: string
    templateApplication: string
    version: number
    spConnDebugLoggingEnabled: boolean
}

export interface AttributeMap {
    newAttribute: string
    existingAttributes: string[]
    attributeMerge?: 'first' | 'list' | 'concatenate' | 'source'
    source?: string
}

export interface AttributeDefinition {
    name: string
    expression?: string
    case?: 'same' | 'lower' | 'upper' | 'capitalize'
    type?: 'normal' | 'unique' | 'uuid' | 'counter'
    counterStart?: number
    digits?: number
    maxLength?: number
    normalize: boolean
    spaces: boolean
    refresh: boolean
    values?: Set<string>
}

export interface FusionAttribute {
    attribute: string
    fusionScore?: number
}

// ============================================================================
// Connection Settings Menu
// ============================================================================

// Connection Settings Section
export interface ConnectionSettingsSection {
    baseurl: string
    clientId: string
    clientSecret: string
}

// Connection Settings Menu
export type ConnectionSettingsMenu = ConnectionSettingsSection

// ============================================================================
// Source Settings Menu
// ============================================================================

// Scope Section
export interface ScopeSection {
    identityScopeQuery?: string
}

// Sources Section
export interface SourcesSection {
    sources: string[]
    forceAggregation: boolean
    /**
     * Number of times to poll the aggregation task result when forceAggregation is enabled.
     */
    taskResultRetries: number
    /**
     * Wait time (in milliseconds) between task status polls when forceAggregation is enabled.
     */
    taskResultWait: number
}

// Processing Control Section
export interface ProcessingControlSection {
    deleteEmpty: boolean
    correlateOnAggregation: boolean
    resetProcessingFlag: boolean
}

// Source Settings Menu
export interface SourceSettingsMenu extends ScopeSection, SourcesSection, ProcessingControlSection {}

// ============================================================================
// Attribute Mapping Settings Menu
// ============================================================================

// Attribute Mapping Definitions Section
export interface AttributeMappingDefinitionsSection {
    attributeMerge: 'first' | 'list' | 'concatenate'
    attributeMaps?: AttributeMap[]
}

// Attribute Mapping Settings Menu
export type AttributeMappingSettingsMenu = AttributeMappingDefinitionsSection

// ============================================================================
// Attribute Definition Settings Menu
// ============================================================================

// Attribute Definition Settings Section
export interface AttributeDefinitionSettingsSection {
    attributeDefinitions: AttributeDefinition[]
}

// Attribute Definition Settings Menu
export type AttributeDefinitionSettingsMenu = AttributeDefinitionSettingsSection

// ============================================================================
// Fusion Settings Menu
// ============================================================================

// Fusion Settings Section
export interface FusionSettingsSection {
    fusionFormAttributes?: string[]
    fusionFormExpirationDays: number
    fusionMergingIdentical: boolean
    fusionUseAverageScore: boolean
    fusionAverageScore?: number
    fusionAttributes?: FusionAttribute[]
}

// Fusion Settings Menu
export type FusionSettingsMenu = FusionSettingsSection

// ============================================================================
// Advanced Settings Menu
// ============================================================================

// Developer Settings Section
export interface DeveloperSettingsSection {
    spConnEnableStatefulCommands: boolean
    reset: boolean
    provisioningTimeout?: number
    externalLoggingEnabled: boolean
    externalLoggingUrl?: string
    externalLoggingLevel?: 'error' | 'warn' | 'info' | 'debug'
}

// Advanced Connection Settings Section
export interface AdvancedConnectionSettingsSection {
    /**
     * Enable queue management for API requests.
     */
    enableQueue: boolean

    /**
     * Enable retry logic for failed API requests.
     */
    enableRetry: boolean

    /**
     * The number of times to retry a failed API request.
     */
    maxRetries?: number

    /**
     * Maximum number of requests to send per second.
     */
    requestsPerSecond?: number

    /**
     * Maximum number of API requests to run concurrently.
     * Used for queueConfig.maxConcurrentRequests.
     */
    maxConcurrentRequests?: number
}

// Advanced Settings Menu
export interface AdvancedSettingsMenu extends DeveloperSettingsSection, AdvancedConnectionSettingsSection {}

// ============================================================================
// Internal/Computed fields
// ============================================================================

export interface InternalConfig {
    fusionScoreMap?: Map<string, number>
    readonly requestsPerSecondConstant: number
    readonly tokenUrlPath: string
    readonly processingWaitConstant: number
    readonly retriesConstant: number
    readonly workflowName: string
    readonly transformName: string
    readonly padding: string
    readonly msDay: number
    readonly identityNotFoundWait: number
    readonly identityNotFoundRetries: number
    readonly separator: string
    readonly fusionFormNamePattern: string
    readonly editFormNamePattern: string
    readonly reservedAttributes: readonly string[]
    readonly nonAggregableTypes: readonly string[]
    readonly pageSize: number
    readonly newIdentityDecision: string
    readonly fusionAccountRefreshThresholdInSeconds: number
    readonly concurrency: {
        readonly uncorrelatedAccounts: number
        readonly processAccounts: number
        readonly correlateAccounts: number
    }
}

// ============================================================================
// Source Config - Combination of all menus
// ============================================================================

export interface FusionConfig
    extends BaseConfig,
        ConnectionSettingsMenu,
        SourceSettingsMenu,
        AttributeMappingSettingsMenu,
        AttributeDefinitionSettingsMenu,
        FusionSettingsMenu,
        AdvancedSettingsMenu,
        InternalConfig {}
