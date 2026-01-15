/**
 * Utility functions for attribute manipulation and transformation
 */

/**
 * Convert attribute name to lowercase-first format (e.g., "DisplayName" -> "displayName")
 * This is commonly used for form field keys and attribute access
 */
export const toLowerCaseFirst = (str: string): string => {
    if (!str || str.length === 0) {
        return str
    }
    return str.charAt(0).toLowerCase() + str.slice(1)
}

/**
 * Capitalize first letter of a string (e.g., "displayName" -> "DisplayName")
 */
export const capitalizeFirst = (str: string): string => {
    if (!str || str.length === 0) {
        return str
    }
    return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Pick specific attributes from an attributes object based on a whitelist
 * Supports both direct attribute names and lowercase-first variants
 *
 * @param attrs - The attributes object to pick from
 * @param attributeNames - Array of attribute names to pick (whitelist)
 * @returns Object containing only the picked attributes, or undefined if no attributes match
 */
export const pickAttributes = (
    attrs: Record<string, any> | undefined,
    attributeNames: string[]
): Record<string, any> | undefined => {
    if (!attrs) {
        return undefined
    }
    if (!attributeNames || attributeNames.length === 0) {
        return undefined
    }

    const picked: Record<string, any> = {}
    for (const name of attributeNames) {
        const direct = attrs[name]
        const lowerFirst = name ? toLowerCaseFirst(name) : name
        const fallback = lowerFirst ? attrs[lowerFirst] : undefined
        const value = direct ?? fallback
        if (value !== undefined && value !== null && value !== '') {
            picked[name] = value
        }
    }
    return Object.keys(picked).length > 0 ? picked : undefined
}

/**
 * Pick attributes and return an empty object if none match (for cases where empty object is preferred over undefined)
 */
export const pickAttributesWithDefault = (
    attrs: Record<string, any> | undefined,
    attributeNames: string[]
): Record<string, any> => {
    return pickAttributes(attrs, attributeNames) ?? {}
}
