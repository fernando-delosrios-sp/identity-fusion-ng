import { scoreLIG3, scoreJaroWinkler } from './helpers'
import { MatchingConfig } from '../../model/config'

/**
 * Head-to-head comparison tests: LIG3 vs Jaro-Winkler
 * 
 * This test suite compares the two algorithms across various
 * identity matching scenarios to understand their strengths.
 */
describe('LIG3 vs Jaro-Winkler Comparison', () => {
    const lig3Config: MatchingConfig = {
        attribute: 'name',
        algorithm: 'lig3',
        fusionScore: 80,
    }

    const jaroConfig: MatchingConfig = {
        attribute: 'name',
        algorithm: 'jaro-winkler',
        fusionScore: 80,
    }

    describe('Names with missing middle initial', () => {
        test('should compare handling of missing middle component', () => {
            const s1 = 'John A Smith'
            const s2 = 'John Smith'

            const lig3Result = scoreLIG3(s1, s2, lig3Config)
            const jaroResult = scoreJaroWinkler(s1, s2, jaroConfig)

            console.log(`\nMissing Middle Initial: "${s1}" vs "${s2}"`)
            console.log(`  LIG3:        ${lig3Result.score}`)
            console.log(`  Jaro-Winkler: ${jaroResult.score}`)

            // Both should score well, but LIG3 handles gaps better
            expect(lig3Result.score).toBeGreaterThan(80)
            expect(jaroResult.score).toBeGreaterThan(80)
        })
    })

    describe('Character transpositions (typos)', () => {
        test('should compare handling of adjacent character swaps', () => {
            const s1 = 'Jonh Smith'
            const s2 = 'John Smith'

            const lig3Result = scoreLIG3(s1, s2, lig3Config)
            const jaroResult = scoreJaroWinkler(s1, s2, jaroConfig)

            console.log(`\nTransposition: "${s1}" vs "${s2}"`)
            console.log(`  LIG3:        ${lig3Result.score}`)
            console.log(`  Jaro-Winkler: ${jaroResult.score}`)

            // Jaro-Winkler is specifically designed for transpositions
            expect(jaroResult.score).toBeGreaterThan(90)
            expect(lig3Result.score).toBeGreaterThan(85)
        })
    })

    describe('International names with accents', () => {
        test('should compare handling of diacritics', () => {
            const s1 = 'José García'
            const s2 = 'Jose Garcia'

            const lig3Result = scoreLIG3(s1, s2, lig3Config)
            const jaroResult = scoreJaroWinkler(s1, s2, jaroConfig)

            console.log(`\nAccents: "${s1}" vs "${s2}"`)
            console.log(`  LIG3:        ${lig3Result.score} (normalized)`)
            console.log(`  Jaro-Winkler: ${jaroResult.score} (character-based)`)

            // LIG3 normalizes accents, Jaro-Winkler treats them as different chars
            expect(lig3Result.score).toBe(100)
            expect(jaroResult.score).toBeLessThan(100)
        })
    })

    describe('Common prefix emphasis', () => {
        test('should compare prefix weighting', () => {
            const s1 = 'Johnson'
            const s2 = 'Johnsen'

            const lig3Result = scoreLIG3(s1, s2, lig3Config)
            const jaroResult = scoreJaroWinkler(s1, s2, jaroConfig)

            console.log(`\nCommon Prefix: "${s1}" vs "${s2}"`)
            console.log(`  LIG3:        ${lig3Result.score}`)
            console.log(`  Jaro-Winkler: ${jaroResult.score}`)

            // Jaro-Winkler specifically weights prefixes
            expect(jaroResult.score).toBeGreaterThan(85)
            expect(lig3Result.score).toBeGreaterThan(80)
        })
    })

    describe('Short strings', () => {
        test('should compare performance on short strings', () => {
            const s1 = 'Jon'
            const s2 = 'John'

            const lig3Result = scoreLIG3(s1, s2, lig3Config)
            const jaroResult = scoreJaroWinkler(s1, s2, jaroConfig)

            console.log(`\nShort Strings: "${s1}" vs "${s2}"`)
            console.log(`  LIG3:        ${lig3Result.score}`)
            console.log(`  Jaro-Winkler: ${jaroResult.score}`)

            // Both should handle short strings well
            expect(lig3Result.score).toBeGreaterThan(70)
            expect(jaroResult.score).toBeGreaterThan(70)
        })
    })

    describe('Very different strings', () => {
        test('should both correctly identify non-matches', () => {
            const s1 = 'John Smith'
            const s2 = 'Jane Doe'

            const lig3Result = scoreLIG3(s1, s2, lig3Config)
            const jaroResult = scoreJaroWinkler(s1, s2, jaroConfig)

            console.log(`\nDifferent Strings: "${s1}" vs "${s2}"`)
            console.log(`  LIG3:        ${lig3Result.score}`)
            console.log(`  Jaro-Winkler: ${jaroResult.score}`)

            // Both should score low
            expect(lig3Result.score).toBeLessThan(40)
            expect(jaroResult.score).toBeLessThan(40)
        })
    })

    describe('Substring matches', () => {
        test('should compare handling when one is substring of other', () => {
            const s1 = 'Smith'
            const s2 = 'John Smith'

            const lig3Result = scoreLIG3(s1, s2, lig3Config)
            const jaroResult = scoreJaroWinkler(s1, s2, jaroConfig)

            console.log(`\nSubstring: "${s1}" vs "${s2}"`)
            console.log(`  LIG3:        ${lig3Result.score}`)
            console.log(`  Jaro-Winkler: ${jaroResult.score}`)

            // Both should detect some similarity
            expect(lig3Result.score).toBeGreaterThan(40)
            expect(jaroResult.score).toBeGreaterThan(40)
        })
    })

    describe('Email addresses', () => {
        test('should compare handling of structured data', () => {
            const s1 = 'john.smith@company.com'
            const s2 = 'jon.smith@company.com'

            const lig3Result = scoreLIG3(s1, s2, lig3Config)
            const jaroResult = scoreJaroWinkler(s1, s2, jaroConfig)

            console.log(`\nEmail Typo: "${s1}" vs "${s2}"`)
            console.log(`  LIG3:        ${lig3Result.score}`)
            console.log(`  Jaro-Winkler: ${jaroResult.score}`)

            // Both should score high (one character difference)
            expect(lig3Result.score).toBeGreaterThan(70)
            expect(jaroResult.score).toBeGreaterThan(90)
        })
    })

    describe('Multi-word token matching', () => {
        test('should compare handling of reordered components', () => {
            const s1 = 'John Michael Smith'
            const s2 = 'John Smith Michael'

            const lig3Result = scoreLIG3(s1, s2, lig3Config)
            const jaroResult = scoreJaroWinkler(s1, s2, jaroConfig)

            console.log(`\nReordered Tokens: "${s1}" vs "${s2}"`)
            console.log(`  LIG3:        ${lig3Result.score} (with token bonus)`)
            console.log(`  Jaro-Winkler: ${jaroResult.score} (character-based)`)

            // LIG3 has token matching, Jaro-Winkler is character-based
            expect(lig3Result.score).toBeGreaterThan(60)
        })
    })

    describe('Extra suffixes/prefixes', () => {
        test('should compare handling of titles and suffixes', () => {
            const s1 = 'Dr. John Smith'
            const s2 = 'John Smith MD'

            const lig3Result = scoreLIG3(s1, s2, lig3Config)
            const jaroResult = scoreJaroWinkler(s1, s2, jaroConfig)

            console.log(`\nTitles/Suffixes: "${s1}" vs "${s2}"`)
            console.log(`  LIG3:        ${lig3Result.score}`)
            console.log(`  Jaro-Winkler: ${jaroResult.score}`)

            // Both should detect the common "John Smith" part
            expect(lig3Result.score).toBeGreaterThan(40)
            expect(jaroResult.score).toBeGreaterThan(40)
        })
    })

    describe('Case sensitivity', () => {
        test('should both handle case differences', () => {
            const s1 = 'JOHN SMITH'
            const s2 = 'john smith'

            const lig3Result = scoreLIG3(s1, s2, lig3Config)
            const jaroResult = scoreJaroWinkler(s1, s2, jaroConfig)

            console.log(`\nCase Difference: "${s1}" vs "${s2}"`)
            console.log(`  LIG3:        ${lig3Result.score}`)
            console.log(`  Jaro-Winkler: ${jaroResult.score}`)

            // LIG3 normalizes case, Jaro-Winkler is case-sensitive
            expect(lig3Result.score).toBe(100)
            expect(jaroResult.score).toBeLessThan(100)
        })
    })

    describe('Whitespace variations', () => {
        test('should compare handling of spacing differences', () => {
            const s1 = 'John  Smith'
            const s2 = 'John Smith'

            const lig3Result = scoreLIG3(s1, s2, lig3Config)
            const jaroResult = scoreJaroWinkler(s1, s2, jaroConfig)

            console.log(`\nWhitespace: "${s1}" vs "${s2}"`)
            console.log(`  LIG3:        ${lig3Result.score}`)
            console.log(`  Jaro-Winkler: ${jaroResult.score}`)

            // LIG3 normalizes whitespace
            expect(lig3Result.score).toBe(100)
            expect(jaroResult.score).toBeGreaterThan(90)
        })
    })

    describe('Very long strings', () => {
        test('should compare handling of longer attributes', () => {
            const s1 = 'John Alexander Benjamin Christopher Smith'
            const s2 = 'John Alexander Benjamin Christopher Smyth'

            const lig3Result = scoreLIG3(s1, s2, lig3Config)
            const jaroResult = scoreJaroWinkler(s1, s2, jaroConfig)

            console.log(`\nLong Strings: "${s1}" vs "${s2}"`)
            console.log(`  LIG3:        ${lig3Result.score}`)
            console.log(`  Jaro-Winkler: ${jaroResult.score}`)

            // Both should score very high (only one character difference at end)
            expect(lig3Result.score).toBeGreaterThan(85)
            expect(jaroResult.score).toBeGreaterThan(85)
        })
    })
})
