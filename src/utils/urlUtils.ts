/**
 * Utility functions for URL manipulation and construction
 */

/**
 * Extract UI origin URL from a base API URL
 * Removes the API subdomain segment (e.g., "api.example.com" -> "example.com")
 * and constructs the UI origin URL
 *
 * @param baseUrl - The base API URL (e.g., "https://api.example.com")
 * @returns The UI origin URL (e.g., "https://example.com") or undefined if URL is invalid
 */
export const extractUIOrigin = (baseUrl: string | undefined): string | undefined => {
    if (!baseUrl) {
        return undefined
    }

    try {
        const url = new URL(baseUrl)
        // Remove the api subdomain segment used by the API host
        const host = url.host.replace('.api.', '.').replace(/^api\./, '')
        return `${url.protocol}//${host}`
    } catch {
        return undefined
    }
}

/**
 * Construct identity detail URL from UI origin and identity ID
 */
export const buildIdentityDetailUrl = (uiOrigin: string | undefined, identityId: string | undefined): string | undefined => {
    if (!uiOrigin || !identityId) {
        return undefined
    }
    return `${uiOrigin}/ui/a/admin/identities/${encodeURIComponent(identityId)}/details/attributes`
}
