import { scoreLIG3, scoreJaroWinkler, scoreDice, scoreDoubleMetaphone, scoreNameMatcher } from './helpers'
import { MatchingConfig } from '../../model/config'

/**
 * Comprehensive comparison of all matching algorithms
 * 
 * This test suite compares all 5 algorithms across various
 * identity matching scenarios to understand their strengths and weaknesses.
 */
describe('Complete Algorithm Comparison', () => {
    const createConfig = (algorithm: string): MatchingConfig => ({
        attribute: 'name',
        algorithm: algorithm as any,
        fusionScore: 80,
    })

    const testScenarios = [
        {
            name: 'Exact match',
            s1: 'John Smith',
            s2: 'John Smith',
        },
        {
            name: 'Case difference',
            s1: 'John Smith',
            s2: 'JOHN SMITH',
        },
        {
            name: 'Minor typo (one char)',
            s1: 'John Smith',
            s2: 'Jon Smith',
        },
        {
            name: 'Transposition',
            s1: 'John Smith',
            s2: 'Jonh Smith',
        },
        {
            name: 'Missing middle initial',
            s1: 'John A Smith',
            s2: 'John Smith',
        },
        {
            name: 'International (accents)',
            s1: 'José García',
            s2: 'Jose Garcia',
        },
        {
            name: 'Common prefix (surnames)',
            s1: 'Johnson',
            s2: 'Johnsen',
        },
        {
            name: 'Short strings',
            s1: 'Jon',
            s2: 'John',
        },
        {
            name: 'Completely different',
            s1: 'John Smith',
            s2: 'Jane Doe',
        },
        {
            name: 'Substring match',
            s1: 'Smith',
            s2: 'John Smith',
        },
        {
            name: 'Email with typo',
            s1: 'john.smith@company.com',
            s2: 'jon.smith@company.com',
        },
        {
            name: 'Reordered tokens',
            s1: 'John Michael Smith',
            s2: 'John Smith Michael',
        },
        {
            name: 'Extra prefix/suffix',
            s1: 'Dr. John Smith',
            s2: 'John Smith MD',
        },
        {
            name: 'Phonetic similarity',
            s1: 'Smith',
            s2: 'Smyth',
        },
        {
            name: 'Similar sounding',
            s1: 'Catherine',
            s2: 'Katherine',
        },
        {
            name: 'Nickname vs formal',
            s1: 'Bob Smith',
            s2: 'Robert Smith',
        },
        {
            name: 'Whitespace variation',
            s1: 'John  Smith',
            s2: 'John Smith',
        },
        {
            name: 'Very long names',
            s1: 'John Alexander Benjamin Christopher Smith',
            s2: 'John Alexander Benjamin Christopher Smyth',
        },
        {
            name: 'Multiple differences',
            s1: 'Jon A. Smyth',
            s2: 'John Smith',
        },
        {
            name: 'International (French)',
            s1: 'François Müller',
            s2: 'Francois Muller',
        },
    ]

    // Run comparison for each scenario
    testScenarios.forEach((scenario) => {
        test(scenario.name, () => {
            const nameMatcher = scoreNameMatcher(scenario.s1, scenario.s2, createConfig('name-matcher'))
            const jaroWinkler = scoreJaroWinkler(scenario.s1, scenario.s2, createConfig('jaro-winkler'))
            const lig3 = scoreLIG3(scenario.s1, scenario.s2, createConfig('lig3'))
            const dice = scoreDice(scenario.s1, scenario.s2, createConfig('dice'))
            const doubleMetaphone = scoreDoubleMetaphone(scenario.s1, scenario.s2, createConfig('double-metaphone'))

            console.log(`\n${scenario.name}: "${scenario.s1}" vs "${scenario.s2}"`)
            console.log(`  Name Matcher:    ${nameMatcher.score.toString().padStart(3)} ${nameMatcher.comment ? `(${nameMatcher.comment})` : ''}`)
            console.log(`  Jaro-Winkler:    ${jaroWinkler.score.toString().padStart(3)}`)
            console.log(`  LIG3:            ${lig3.score.toString().padStart(3)} ${lig3.comment ? `(${lig3.comment})` : ''}`)
            console.log(`  Dice:            ${dice.score.toString().padStart(3)}`)
            console.log(`  Double Metaphone: ${doubleMetaphone.score.toString().padStart(3)} ${doubleMetaphone.comment ? `(${doubleMetaphone.comment})` : ''}`)

            // All tests pass - this is just for data collection
            expect(true).toBe(true)
        })
    })

    // Summary test to output a table
    test('Generate comparison summary', () => {
        console.log('\n\n=== ALGORITHM COMPARISON SUMMARY ===\n')
        console.log('Scenario'.padEnd(35) + ' | ' + 'Name'.padEnd(4) + ' | ' + 'J-W'.padEnd(4) + ' | ' + 'LIG3'.padEnd(4) + ' | ' + 'Dice'.padEnd(4) + ' | ' + 'D-M'.padEnd(4))
        console.log('-'.repeat(35) + '-+-' + '-'.repeat(4) + '-+-' + '-'.repeat(4) + '-+-' + '-'.repeat(4) + '-+-' + '-'.repeat(4) + '-+-' + '-'.repeat(4))

        testScenarios.forEach((scenario) => {
            const nameMatcher = scoreNameMatcher(scenario.s1, scenario.s2, createConfig('name-matcher'))
            const jaroWinkler = scoreJaroWinkler(scenario.s1, scenario.s2, createConfig('jaro-winkler'))
            const lig3 = scoreLIG3(scenario.s1, scenario.s2, createConfig('lig3'))
            const dice = scoreDice(scenario.s1, scenario.s2, createConfig('dice'))
            const doubleMetaphone = scoreDoubleMetaphone(scenario.s1, scenario.s2, createConfig('double-metaphone'))

            const name = scenario.name.padEnd(35)
            const nm = nameMatcher.score.toString().padStart(4)
            const jw = jaroWinkler.score.toString().padStart(4)
            const lg = lig3.score.toString().padStart(4)
            const dc = dice.score.toString().padStart(4)
            const dm = doubleMetaphone.score.toString().padStart(4)

            console.log(`${name} | ${nm} | ${jw} | ${lg} | ${dc} | ${dm}`)
        })

        expect(true).toBe(true)
    })
})
