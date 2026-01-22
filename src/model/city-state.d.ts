declare module 'city-state' {
    /**
     * Get all cities for a given state
     * @param state - State name or abbreviation (e.g., 'NY', 'New York')
     * @returns Array of city names
     */
    export function getCities(state: string): string[]

    /**
     * Get all states that contain a city with the given name
     * @param city - City name (e.g., 'Seattle')
     * @returns Array of state abbreviations (e.g., ['WA'])
     */
    export function getStates(city: string): string[]

    /**
     * Get state code for a city, optionally specifying the state
     * @param city - City name
     * @param state - Optional state name or abbreviation
     * @returns State abbreviation (e.g., 'NY') or undefined if not found
     */
    export function getStateCode(city: string, state?: string): string | undefined

    /**
     * Get city-state object with lookup methods
     */
    export interface CityStateObject {
        getCities(state: string): string[]
        getStates(city: string): string[]
        getStateCode(city: string, state?: string): string | undefined
    }

    const cityState: CityStateObject
    export default cityState
}
