import { ConnectorError, ConnectorErrorType, readConfig } from '@sailpoint/connector-sdk'
import { FusionConfig, SourceConfig } from '../model/config'

const internalConfig = {
    requestsPerSecondConstant: 100,
    pageSize: 250,
    tokenUrlPath: '/oauth/token',
    processingWaitConstant: 60 * 1000,
    retriesConstant: 20,
    workflowName: 'Email Sender',
    transformName: 'Fusion Transform',
    padding: '   ',
    msDay: 86400000,
    identityNotFoundWait: 5000,
    identityNotFoundRetries: 5,
    separator: ' | ',
    fusionFormNamePattern: 'Identity Merging',
    editFormNamePattern: 'Fusion account edit form',
    reservedAttributes: [
        'uuid',
        'name',
        'history',
        'statuses',
        'actions',
        'reviews',
        'accounts',
        'missing-accounts',
        'IIQDisabled',
        'IIQLocked',
        'idNowDescription',
        'enabled',
    ],
    nonAggregableTypes: ['DelimitedFile'],
    concurrency: {
        uncorrelatedAccounts: 500,
        processAccounts: 50,
        correlateAccounts: 25,
    },
    newIdentityDecision: 'This is a new identity',
    fusionAccountRefreshThresholdInSeconds: 60,
}

// NOTE: Don't add defaults from connector-spec.json here. Instead, add them to the connector-spec.json file.
export const safeReadConfig = async (): Promise<FusionConfig> => {
    const sourceConfig = await readConfig()
    const config = {
        ...sourceConfig,
        ...internalConfig, // Internal constants always take precedence
    }

    // ============================================================================
    // Array defaults - ensure arrays are never undefined
    // ============================================================================
    config.attributeMaps = config.attributeMaps ?? []
    config.attributeDefinitions = config.attributeDefinitions ?? []
    config.sources = config.sources ?? []
    config.fusionFormAttributes = config.fusionFormAttributes ?? []
    config.fusionAttributes = config.fusionAttributes ?? []

    // ============================================================================
    // Source Settings defaults
    // ============================================================================
    // Set defaults for each source configuration
    config.sources = config.sources.map((sourceConfig: SourceConfig) => ({
        ...sourceConfig,
        forceAggregation: sourceConfig.forceAggregation ?? false,
        accountFilter: sourceConfig.accountFilter ?? undefined,
    }))
    // Global aggregation task polling defaults (used for all sources with force aggregation enabled)
    config.taskResultRetries = config.taskResultRetries ?? 5
    config.taskResultWait = config.taskResultWait ?? 1000
    config.correlateOnAggregation = config.correlateOnAggregation ?? false
    config.resetProcessingFlag = config.resetProcessingFlag ?? false
    config.deleteEmpty = config.deleteEmpty ?? false

    // ============================================================================
    // Attribute Definition Settings defaults
    // ============================================================================
    config.maxAttempts = config.maxAttempts ?? 100

    // ============================================================================
    // Fusion Settings defaults
    // ============================================================================
    // Default from connector-spec.json: fusionExpirationDays: 7
    config.fusionFormExpirationDays = config.fusionFormExpirationDays ?? 7
    config.fusionMergingIdentical = config.fusionMergingIdentical ?? false
    config.fusionUseAverageScore = config.fusionUseAverageScore ?? false
    // fusionAverageScore is only used when fusionUseAverageScore is true
    // Default to 80 (80% similarity threshold) if not specified
    config.fusionAverageScore = config.fusionAverageScore ?? 80

    // ============================================================================
    // Advanced Connection Settings defaults
    // ============================================================================
    config.enableQueue = config.enableQueue ?? false
    config.enableRetry = config.enableRetry ?? false

    // Defaults from connector-spec.json: maxRetries: 20, requestsPerSecond: 10, maxConcurrentRequests: 10
    config.maxRetries = config.maxRetries ?? internalConfig.retriesConstant
    config.requestsPerSecond = config.requestsPerSecond ?? 10
    config.maxConcurrentRequests = config.maxConcurrentRequests ?? 10
    config.retryDelay = config.retryDelay ?? 1000 // 1 second base delay (only used as fallback, 429 responses use retry-after header)
    config.pageSize = config.batchSize ?? 250 // Paging size is 250 for all calls
    config.enableBatching = config.enableBatching ?? false
    config.enablePriority = config.enablePriority ?? false
    // processingWait defaults to processingWaitConstant (60 seconds)
    config.processingWait = config.processingWait ?? internalConfig.processingWaitConstant

    // ============================================================================
    // Developer Settings defaults
    // ============================================================================
    config.spConnEnableStatefulCommands = config.spConnEnableStatefulCommands ?? false
    config.reset = config.reset ?? false
    // Default from connector-spec.json: provisioningTimeout: 300
    config.provisioningTimeout = config.provisioningTimeout ?? 300
    config.externalLoggingEnabled = config.externalLoggingEnabled ?? false
    config.externalLoggingUrl = config.externalLoggingUrl ?? undefined
    // Default to 'info' level for external logging if enabled but level not specified
    config.externalLoggingLevel = config.externalLoggingLevel ?? 'info'

    if (config.fusionUseAverageScore) {
        config.getScore = (attribute?: string): number => {
            return config.fusionAverageScore
        }
    } else {
        config.fusionScoreMap = new Map<string, number>()
        for (const { attribute, fusionScore } of config.fusionAttributes) {
            config.fusionScoreMap.set(attribute, fusionScore)
        }
        config.getScore = (attribute?: string): number => {
            const score = config.fusionScoreMap.get(attribute!)
            if (!score) {
                throw new ConnectorError(
                    `Fusion score not found for attribute: ${attribute}`,
                    ConnectorErrorType.NotFound
                )
            }
            return score
        }
    }

    return config
}
