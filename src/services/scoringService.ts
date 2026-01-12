import { FusionAccount } from '../model/account'
import { MatchingConfig, FusionConfig } from '../model/config'
import { LogService } from './logService'
import * as stringComparison from 'string-comparison'
import { doubleMetaphone } from 'double-metaphone'
import * as nameMatch from 'name-match'

const { jaroWinkler, diceCoefficient } = stringComparison.default

type ScoreReport = MatchingConfig & {
    score: number
    isMatch: boolean
    comment?: string
}

export type FusionMatch = {
    fusionIdentity: FusionAccount
    scores: ScoreReport[]
}
/**
 * Service for calculating and managing similarity scores for identity matching.
 * Handles score calculation, threshold checking, and score formatting.
 */
export class ScoringService {
    private readonly matchingConfigs: MatchingConfig[]
    private readonly fusionUseAverageScore: boolean
    private readonly fusionAverageScore: number
    private reportMode: boolean = false
    constructor(
        config: FusionConfig,
        private log: LogService
    ) {
        this.matchingConfigs = config.matchingConfigs ?? []
        this.fusionUseAverageScore = config.fusionUseAverageScore ?? false
        this.fusionAverageScore = config.fusionAverageScore ?? 0
    }

    public enableReportMode(): void {
        this.reportMode = true
    }

    public scoreFusionAccount(fusionAccount: FusionAccount, fusionIdentities: FusionAccount[]): void {
        fusionIdentities.forEach((fusionIdentity) => {
            this.compareFusionAccounts(fusionAccount, fusionIdentity)
        })
    }

    private compareFusionAccounts(
        fusionAccount: FusionAccount,
        fusionIdentity: FusionAccount
    ): FusionMatch | undefined {
        const fullRun = this.reportMode || this.fusionUseAverageScore
        const scores: ScoreReport[] = []
        let isMatch = false

        for (const matching of this.matchingConfigs) {
            const accountAttribute = fusionAccount.attributes[matching.attribute]
            const identityAttribute = fusionIdentity.attributes[matching.attribute]
            if (accountAttribute && identityAttribute) {
                const scoreReport: ScoreReport = this.scoreAttribute(
                    accountAttribute.toString(),
                    identityAttribute.toString(),
                    matching
                )
                if (!scoreReport.isMatch && matching.mandatory && !fullRun) {
                    return
                }
                isMatch = isMatch || scoreReport.isMatch
                scores.push(scoreReport)
            }
        }

        if (this.fusionUseAverageScore) {
            const score = scores.reduce((acc, score) => acc + score.score, 0) / scores.length
            const match = score >= this.fusionAverageScore

            const scoreReport: ScoreReport = {
                attribute: 'Average Score',
                algorithm: 'average',
                fusionScore: this.fusionAverageScore,
                mandatory: true,
                score,
                isMatch: match,
                comment: match ? 'Average score is above threshold' : 'Average score is below threshold',
            }
            scores.push(scoreReport)
            isMatch = match
        }

        const fusionMatch: FusionMatch = {
            fusionIdentity,
            scores,
        }
        if (isMatch) {
            fusionAccount.addFusionMatch(fusionMatch)
        }
    }

    private scoreAttribute(
        accountAttribute: string,
        identityAttribute: string,
        matchingConfig: MatchingConfig
    ): ScoreReport {
        switch (matchingConfig.algorithm) {
            case 'name-matcher':
                return this.scoreNameMatcher(accountAttribute, identityAttribute, matchingConfig)
            case 'jaro-winkler':
                return this.scoreJaroWinkler(accountAttribute, identityAttribute, matchingConfig)
            case 'dice':
                return this.scoreDice(accountAttribute, identityAttribute, matchingConfig)
            case 'double-metaphone':
                return this.scoreDoubleMetaphone(accountAttribute, identityAttribute, matchingConfig)
            case 'custom':
                this.log.crash('Custom algorithm not implemented')
        }
        return { ...matchingConfig, score: 0, isMatch: false }
    }

    private scoreDice(accountAttribute: string, identityAttribute: string, matching: MatchingConfig): ScoreReport {
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

    private scoreDoubleMetaphone(
        accountAttribute: string,
        identityAttribute: string,
        matching: MatchingConfig
    ): ScoreReport {
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

    private scoreJaroWinkler(
        accountAttribute: string,
        identityAttribute: string,
        matching: MatchingConfig
    ): ScoreReport {
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

    private scoreNameMatcher(
        accountAttribute: string,
        identityAttribute: string,
        matching: MatchingConfig
    ): ScoreReport {
        const similarity = nameMatch.match(accountAttribute, identityAttribute)
        // name-match returns a normalized score (0-1), convert to 0-100
        const score = Math.round(similarity * 100)

        const threshold = matching.fusionScore ?? 0
        const isMatch = score >= threshold

        return {
            ...matching,
            score,
            isMatch,
        }
    }
}
