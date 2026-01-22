import { scoreLIG3 } from './helpers'
import { MatchingConfig } from '../../model/config'

describe('LIG3 Similarity Algorithm', () => {
    const baseConfig: MatchingConfig = {
        attribute: 'name',
        algorithm: 'lig3',
        fusionScore: 80,
        mandatory: false,
    }

    describe('Exact matches', () => {
        test('should return 100 for identical strings', () => {
            const result = scoreLIG3('John Smith', 'John Smith', baseConfig)
            expect(result.score).toBe(100)
            expect(result.isMatch).toBe(true)
            expect(result.comment).toBe('Exact match')
        })

        test('should handle case-insensitive matching', () => {
            const result = scoreLIG3('JOHN SMITH', 'john smith', baseConfig)
            expect(result.score).toBe(100)
            expect(result.isMatch).toBe(true)
        })

        test('should normalize whitespace', () => {
            const result = scoreLIG3('John  Smith', 'John Smith', baseConfig)
            expect(result.score).toBe(100)
            expect(result.isMatch).toBe(true)
        })
    })

    describe('High similarity matches', () => {
        test('should handle minor typos', () => {
            const result = scoreLIG3('John Smith', 'Jon Smith', baseConfig)
            expect(result.score).toBeGreaterThan(85)
            expect(result.isMatch).toBe(true)
        })

        test('should handle missing middle initial', () => {
            const result = scoreLIG3('John A Smith', 'John Smith', baseConfig)
            expect(result.score).toBeGreaterThan(80)
            expect(result.isMatch).toBe(true)
        })

        test('should handle transposed characters', () => {
            const result = scoreLIG3('Jonh Smith', 'John Smith', baseConfig)
            expect(result.score).toBeGreaterThan(90)
            expect(result.isMatch).toBe(true)
        })

        test('should handle accent normalization', () => {
            const result = scoreLIG3('José García', 'Jose Garcia', baseConfig)
            expect(result.score).toBe(100)
            expect(result.isMatch).toBe(true)
        })
    })

    describe('Moderate similarity', () => {
        test('should handle abbreviated names', () => {
            const result = scoreLIG3('J Smith', 'John Smith', baseConfig)
            expect(result.score).toBeGreaterThan(60)
            expect(result.score).toBeLessThan(90)
        })

        test('should handle different word order with token matching', () => {
            const result = scoreLIG3('Smith John', 'John Smith', baseConfig)
            expect(result.score).toBeGreaterThan(25)
            expect(result.score).toBeLessThan(50)
        })
    })

    describe('Low similarity', () => {
        test('should return low score for completely different strings', () => {
            const result = scoreLIG3('John Smith', 'Jane Doe', baseConfig)
            expect(result.score).toBeLessThan(40)
            expect(result.isMatch).toBe(false)
        })

        test('should handle partially matching strings', () => {
            const result = scoreLIG3('John Smith', 'John Williams', baseConfig)
            expect(result.score).toBeGreaterThan(40)
            expect(result.score).toBeLessThan(70)
        })
    })

    describe('Edge cases', () => {
        test('should handle empty strings', () => {
            const result = scoreLIG3('', 'John Smith', baseConfig)
            expect(result.score).toBe(0)
            expect(result.isMatch).toBe(false)
            expect(result.comment).toBe('Empty string comparison')
        })

        test('should handle single character strings', () => {
            const result = scoreLIG3('J', 'John', baseConfig)
            expect(result.score).toBeGreaterThan(0)
        })

        test('should handle very long strings', () => {
            const long1 = 'John Alexander Benjamin Christopher Smith'
            const long2 = 'John Alexander Benjamin Christopher Smyth'
            const result = scoreLIG3(long1, long2, baseConfig)
            expect(result.score).toBeGreaterThan(85)
        })
    })

    describe('Prefix bonus', () => {
        test('should give higher scores for common prefixes', () => {
            const result1 = scoreLIG3('Johnson', 'Johnsen', baseConfig)
            const result2 = scoreLIG3('Johnson', 'Peterson', baseConfig)
            expect(result1.score).toBeGreaterThan(result2.score)
        })
    })

    describe('Token matching', () => {
        test('should benefit from matching tokens in multi-word strings', () => {
            const result = scoreLIG3('John Michael Smith', 'John Smith Michael', baseConfig)
            expect(result.score).toBeGreaterThan(60)
        })

        test('should handle extra tokens', () => {
            const result = scoreLIG3('John Smith Jr', 'John Smith', baseConfig)
            expect(result.score).toBeGreaterThan(75)
        })
    })

    describe('Threshold matching', () => {
        test('should respect custom thresholds', () => {
            const strictConfig: MatchingConfig = {
                ...baseConfig,
                fusionScore: 95,
            }
            const result = scoreLIG3('John Smith', 'Jon Smith', strictConfig)
            expect(result.score).toBeLessThan(95)
            expect(result.isMatch).toBe(false)
        })

        test('should match with lower threshold', () => {
            const lenientConfig: MatchingConfig = {
                ...baseConfig,
                fusionScore: 60,
            }
            const result = scoreLIG3('J Smith', 'John Smith', lenientConfig)
            expect(result.isMatch).toBe(true)
        })
    })

    describe('Real-world scenarios', () => {
        test('should match email addresses with typos', () => {
            const result = scoreLIG3('john.smith@company.com', 'jon.smith@company.com', baseConfig)
            expect(result.score).toBeGreaterThan(70)
        })

        test('should match usernames with variations', () => {
            const result = scoreLIG3('jsmith123', 'jsmith124', baseConfig)
            expect(result.score).toBeGreaterThan(70)
        })

        test('should match names with suffixes', () => {
            const result = scoreLIG3('Dr. John Smith', 'John Smith MD', baseConfig)
            expect(result.score).toBeGreaterThan(50)
        })

        test('should handle nicknames and formal names', () => {
            const result = scoreLIG3('Bob Smith', 'Robert Smith', baseConfig)
            expect(result.score).toBeGreaterThan(55)
        })
    })
})
