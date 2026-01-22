declare module 'parse-address-string' {
    /**
     * Parsed address components
     */
    export interface ParsedAddress {
        /** Street number (e.g., '123') */
        street_address1?: string
        /** Street name (e.g., 'Main St') */
        street_address2?: string
        /** City name (e.g., 'New York') */
        city?: string
        /** State abbreviation (e.g., 'NY') */
        state?: string
        /** ZIP code (e.g., '10001') */
        postal_code?: string
        /** Country (usually 'USA') */
        country?: string
    }

    /**
     * Parse an address string into its components
     * @param addressString - Full address string to parse
     * @param callback - Callback with (error, parsedAddress)
     */
    export default function parseAddress(
        addressString: string,
        callback: (error: Error | null, parsedAddress: ParsedAddress) => void
    ): void

    /**
     * Promise-based version (for async/await)
     */
    export function parseAddressAsync(addressString: string): Promise<ParsedAddress>
}
