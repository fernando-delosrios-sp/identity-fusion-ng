// Adapted from https://yomguithereal.github.io/talisman/
import levenshtein from 'fast-levenshtein'

/**
 * LIG3 similarity metric.
 *
 * @param  {string} a - First sequence.
 * @param  {string} b - Second sequence.
 * @return {number} Similarity score between 0 and 1
 */
export function lig3(a: string, b: string): number {
    if (a === b) return 1

    // Swapping so that a is the shortest
    if (a.length > b.length) {
        const tmp = a
        a = b
        b = tmp
    }

    let C = levenshtein.get(a, b)
    let I = b.length - C

    return (2 * I) / (2 * I + C)
}

