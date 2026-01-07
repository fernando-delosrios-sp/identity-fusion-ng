import { FusionConfig } from '../model/config'
import { LogService } from './logService'
import { lig3 } from '../utils/lig'

/**
 * Service for calculating and managing similarity scores for identity matching.
 * Handles score calculation, threshold checking, and score formatting.
 */
export class ScoringService {
    analyzeFusionAccount(_fusionAccount: unknown, _fusionIdentities: unknown[]): void {}
    private mergingMapByIdentity: Map<string, any> = new Map()

    constructor(
        private config: FusionConfig,
        private log: LogService
    ) {
        this.buildMergingMapLookup()
    }

    /**
     * Build merging map lookup for faster access
     */
    private buildMergingMapLookup(): void {
        this.mergingMapByIdentity.clear()

        // Build lookup map for merging_map by identity attribute
        // Note: merging_map is now attributeMaps in the new config structure
        const mergingMap = this.config.attributeMaps || []

        for (const mergingConfig of mergingMap) {
            // Map new structure to old structure
            const identityAttr = mergingConfig.newAttribute
            this.mergingMapByIdentity.set(identityAttr, {
                identity: identityAttr,
                account: mergingConfig.existingAttributes || [],
                attributeMerge: mergingConfig.attributeMerge || this.config.attributeMerge,
                source: mergingConfig.source,
                merging_score: this.config.fusionScoreMap?.get(identityAttr),
            })
        }
    }

    /**
     * Get merging score threshold for an attribute
     * @param attribute - Optional attribute name. If not provided, returns average score threshold.
     * @returns The threshold score for the attribute
     */
    public getMergingScore(attribute?: string): number {
        if (this.config.fusionUseAverageScore) {
            return this.config.fusionAverageScore ?? 0
        }

        if (attribute) {
            const attributeConfig = this.mergingMapByIdentity.get(attribute)
            return attributeConfig?.merging_score ?? 0
        }

        return this.config.fusionAverageScore ?? 0
    }

    /**
     * Calculate similarity score between two string values using LIG3 algorithm
     * @param value1 - First value to compare
     * @param value2 - Second value to compare
     * @returns Similarity score between 0 and 100 (percentage)
     */
    public calculateSimilarityScore(value1: string, value2: string): number {
        if (!value1 || !value2) {
            return 0
        }

        const similarity = lig3(value1.trim(), value2.trim())
        return similarity * 100
    }

    /**
     * Check if a score meets the threshold for a given attribute
     * @param score - The calculated similarity score
     * @param attribute - Optional attribute name for attribute-specific thresholds
     * @returns True if score meets or exceeds the threshold
     */
    public meetsThreshold(score: number, attribute?: string): boolean {
        const threshold = this.getMergingScore(attribute)
        return score >= threshold
    }

    /**
     * Calculate average score from a map of attribute scores
     * @param scores - Map of attribute names to scores
     * @param totalAttributes - Total number of attributes being compared
     * @returns Average score across all attributes
     */
    public calculateAverageScore(scores: Map<string, number>, totalAttributes: number): number {
        if (scores.size === 0 || totalAttributes === 0) {
            return 0
        }

        const sum = [...scores.values()].reduce((prev, curr) => prev + curr, 0)
        return sum / totalAttributes
    }

    /**
     * Format a score map as a human-readable string
     * @param score - Map of attribute names to score strings
     * @returns Formatted string like "attribute1 (85), attribute2 (90)"
     */
    public stringifyScore(score: Map<string, string>): string {
        const keys = Array.from(score.keys())
        return keys.map((x) => `${x} (${score.get(x)})`).join(', ')
    }

    /**
     * Format a score map as a compact string for logging
     * @param score - Map of attribute names to score strings
     * @returns Formatted string like "attribute1:85, attribute2:90"
     */
    public formatScoreCompact(score: Map<string, string>): string {
        const entries: string[] = []
        score.forEach((v, k) => {
            entries.push(`${k}:${v}`)
        })
        return entries.join(', ')
    }

    /**
     * Check if all scores in a map are perfect (100)
     * @param score - Map of attribute names to score strings
     * @returns True if all scores are '100'
     */
    public isPerfectMatch(score: Map<string, string>): boolean {
        return [...score.values()].every((x) => x === '100')
    }

    /**
     * Check if average score mode is enabled
     * @returns True if using average score mode
     */
    public isAverageScoreMode(): boolean {
        return this.config.fusionUseAverageScore ?? false
    }

    /**
     * Get the configured average score threshold
     * @returns The average score threshold
     */
    public getAverageScoreThreshold(): number {
        return this.config.fusionAverageScore ?? 0
    }
}
