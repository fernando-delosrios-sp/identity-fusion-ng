import { AttributeDefinition } from '../../model/config'
import { Attributes } from '@sailpoint/connector-sdk'
import { AttributeMappingConfig } from './types'
import { UNIQUE_ATTRIBUTE_TYPES } from './constants'

// ============================================================================
// Helper Functions
// ============================================================================

export const isUniqueAttribute = (definition: AttributeDefinition): boolean => {
    return definition.type !== undefined && UNIQUE_ATTRIBUTE_TYPES.includes(definition.type as any)
}

/**
 * Split attribute value that may contain bracketed values like [value1] [value2]
 */
export const attrSplit = (text: string): string[] => {
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
export const processAttributeMapping = (
    config: AttributeMappingConfig,
    sourceAttributeMap: Map<string, Attributes[]>,
    sourceOrder: string[]
): any => {
    const { sourceAttributes, attributeName, attributeMerge, source: specifiedSource } = config
    const multiValue: string[] = []
    const attributeNames = Array.from(new Set([...sourceAttributes, attributeName]))

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
            for (const attribute of attributeNames) {
                const value = account[attribute]
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
export const buildAttributeMappingConfig = (
    attributeName: string,
    attributeMaps: any[] | undefined,
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
