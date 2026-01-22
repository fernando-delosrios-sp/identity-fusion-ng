import { doubleMetaphone } from 'double-metaphone'
import { MatchingConfig } from '../../model/config'
import { ScoreReport } from './types'
import { jaroWinkler, diceCoefficient } from '../../utils/stringComparison'
import { match as nameMatch } from '../../utils/nameMatching'

// ============================================================================
// Helper Functions
// ============================================================================

export const scoreDice = (accountAttribute: string, identityAttribute: string, matching: MatchingConfig): ScoreReport => {
    const similarity = diceCoefficient.similarity(accountAttribute, identityAttribute)
    const score = Math.round(similarity * 100)

    const threshold = matching.fusionScore ?? 0
    const isMatch = score >= threshold

    return {
        ...matching,
        score,
        isMatch,
    }
}

export const scoreDoubleMetaphone = (
    accountAttribute: string,
    identityAttribute: string,
    matching: MatchingConfig
): ScoreReport => {
    const accountCodes = doubleMetaphone(accountAttribute)
    const identityCodes = doubleMetaphone(identityAttribute)

    let score = 0
    let comment = ''

    if (accountCodes[0] === identityCodes[0] && accountCodes[0]) {
        score = 100
        comment = 'Primary codes match'
    } else if (accountCodes[1] === identityCodes[1] && accountCodes[1]) {
        score = 80
        comment = 'Secondary codes match'
    } else if (accountCodes[0] === identityCodes[1] || accountCodes[1] === identityCodes[0]) {
        score = 70
        comment = 'Cross-match between primary and secondary codes'
    } else {
        score = 0
        comment = 'No phonetic match'
    }

    const threshold = matching.fusionScore ?? 0
    const isMatch = score >= threshold

    return {
        ...matching,
        score,
        isMatch,
        comment,
    }
}

export const scoreJaroWinkler = (
    accountAttribute: string,
    identityAttribute: string,
    matching: MatchingConfig
): ScoreReport => {
    const similarity = jaroWinkler.similarity(accountAttribute, identityAttribute)
    const score = Math.round(similarity * 100)

    const threshold = matching.fusionScore ?? 0
    const isMatch = score >= threshold

    return {
        ...matching,
        score,
        isMatch,
    }
}

export const scoreNameMatcher = (
    accountAttribute: string,
    identityAttribute: string,
    matching: MatchingConfig
): ScoreReport => {
    const similarity = nameMatch(accountAttribute, identityAttribute)
    // nameMatch returns a normalized score (0-1), convert to 0-100
    const score = Math.round(similarity * 100)

    const threshold = matching.fusionScore ?? 0
    const isMatch = score >= threshold

    return {
        ...matching,
        score,
        isMatch,
    }
}
