/**
 * FormService constants
 */

/**
 * Friendly algorithm names (aligned with connector-spec.json)
 */
export const ALGORITHM_LABELS: Record<string, string> = {
    'name-matcher': 'Enhanced Name Matcher',
    'jaro-winkler': 'Jaro-Winkler',
    dice: 'Dice',
    'double-metaphone': 'Double Metaphone',
    lig3: 'LIG3',
    custom: 'Custom Algorithm (from SaaS customizer)',
    average: 'Average Score',
}
