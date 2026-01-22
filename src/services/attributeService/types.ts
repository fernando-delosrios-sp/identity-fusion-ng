// ============================================================================
// Type Definitions
// ============================================================================

export type AttributeMerge = 'first' | 'list' | 'concatenate' | 'source'

export type AttributeMappingConfig = {
    attributeName: string
    sourceAttributes: string[] // Attributes to look for in source accounts
    attributeMerge: AttributeMerge
    source?: string // Specific source to use (for 'source' merge strategy)
}
