import {
    FormElementV2025,
    FormDefinitionInputV2025,
} from 'sailpoint-api-client'
import { FusionAccount } from '../../model/account'
import { capitalizeFirst } from '../../utils/attributes'
import { ALGORITHM_LABELS } from './constants'
import { Candidate } from './types'

// ============================================================================
// Form Building Functions
// ============================================================================

/**
 * Build form input data structure
 */
export const buildFormInput = (
    fusionAccount: FusionAccount,
    candidates: Candidate[],
    fusionFormAttributes?: string[]
): { [key: string]: any } => {
    const formInput: { [key: string]: any } = {}

    const accountIdentifier =
        String(fusionAccount.managedAccountId || '').trim() ||
        String(fusionAccount.nativeIdentityOrUndefined || '').trim() ||
        String((fusionAccount.attributes as any)?.id || '').trim() ||
        String((fusionAccount.attributes as any)?.uuid || '').trim() ||
        String(fusionAccount.identityId || '').trim() ||
        'unknown'

    // NOTE: formInput must match the form definition input types.
    // Keep values primitive (STRING/BOOLEAN/NUMBER) to avoid Custom Forms payload issues.
    formInput.name =
        fusionAccount.name ||
        fusionAccount.displayName ||
        fusionAccount.nativeIdentityOrUndefined ||
        accountIdentifier
    formInput.account = accountIdentifier
    formInput.source = fusionAccount.sourceName
    // Defaults for interactive decision fields
    // Keep as string for newIdentity to align with TOGGLE element.
    formInput.newIdentity = 'false'

    // New identity attributes (flat keys for form elements)
    if (fusionFormAttributes && fusionFormAttributes.length > 0) {
        fusionFormAttributes.forEach((attrName) => {
            const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
            const attrValue = fusionAccount.attributes?.[attrName] || fusionAccount.attributes?.[attrKey] || ''
            formInput[`newidentity.${attrKey}`] = String(attrValue)
        })
    }

    // Candidate attributes and scores (flat keys for form elements)
    candidates.forEach((candidate) => {
        if (!candidate || !candidate.id) return
        const candidateId = candidate.id

        if (fusionFormAttributes && fusionFormAttributes.length > 0) {
            fusionFormAttributes.forEach((attrName) => {
                const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
                const attrValue = candidate.attributes?.[attrName] || candidate.attributes?.[attrKey] || ''
                formInput[`${candidateId}.${attrKey}`] = String(attrValue)
            })
        }

        // Add score inputs
        if (candidate.scores && Array.isArray(candidate.scores) && candidate.scores.length > 0) {
            candidate.scores.forEach((score: any) => {
                if (!score || typeof score !== 'object') return
                if (score.type && score.value !== undefined) {
                    formInput[`${candidateId}.${score.type}.score`] = String(score.value)
                    if (score.threshold !== undefined) {
                        formInput[`${candidateId}.${score.type}.threshold`] = String(score.threshold)
                    }
                }
            })
        }
    })

    return formInput
}

/**
 * Build form fields for fusion form definition
 */
export const buildFormFields = (
    fusionAccount: FusionAccount,
    candidates: Candidate[],
    fusionFormAttributes?: string[]
): FormElementV2025[] => {
    const formFields: FormElementV2025[] = []

    // Top section: Fusion review required header
    const topSectionElements: FormElementV2025[] = []
    if (fusionFormAttributes && fusionFormAttributes.length > 0) {
        fusionFormAttributes.forEach((attrName) => {
            const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
            const attrValue = fusionAccount.attributes?.[attrName] ?? fusionAccount.attributes?.[attrKey] ?? ''
            topSectionElements.push({
                id: `newidentity.${attrKey}`,
                key: `newidentity.${attrKey}`,
                elementType: 'TEXT',
                config: {
                    label: capitalizeFirst(attrName),
                    // Prefill visible values at definition-time so instances don't render blank.
                    default: String(attrValue),
                },
                validations: [],
            })
        })
    }

    if (topSectionElements.length > 0) {
        formFields.push({
            id: 'topSection',
            key: 'topSection',
            elementType: 'SECTION',
            config: {
                alignment: 'CENTER',
                description:
                    'A potential duplicate identity has been detected. Please review the candidate identities below and either select an existing identity to link this account to, or choose to create a new identity.',
                formElements: topSectionElements,
                label: `Fusion review required for ${fusionAccount.sourceName}`,
                labelStyle: 'h2',
                showLabel: true,
            },
            validations: [],
        })
    }

    // Build search query for identities: id:xxx OR id:yyy OR id:zzz
    const identityIds = candidates.map((candidate) => candidate.id)
    const identitySearchQuery = identityIds.map((id) => `id:${id}`).join(' OR ')

    // Fusion decision section: New identity toggle and identities select in a COLUMN_SET
    formFields.push({
        id: 'identitiesSection',
        key: 'identitiesSection',
        elementType: 'SECTION',
        config: {
            alignment: 'CENTER',
            formElements: [
                {
                    id: 'decisionsColumnSet',
                    key: 'decisionsColumnSet',
                    elementType: 'COLUMN_SET',
                    config: {
                        alignment: 'CENTER',
                        columnCount: 2,
                        columns: [
                            [
                                {
                                    id: 'newIdentity',
                                    key: 'newIdentity',
                                    elementType: 'TOGGLE',
                                    config: {
                                        label: 'New identity',
                                        default: false,
                                        trueLabel: 'True',
                                        falseLabel: 'False',
                                        helpText: 'Select this if the account is a new identity',
                                    },
                                    validations: [],
                                },
                            ],
                            [
                                {
                                    id: 'identities',
                                    key: 'identities',
                                    elementType: 'SELECT',
                                    config: {
                                        dataSource: {
                                            config: {
                                                indices: ['identities'],
                                                query: identitySearchQuery,
                                                label: 'attributes.displayName',
                                                sublabel: 'attributes.email',
                                                value: 'id',
                                            },
                                            dataSourceType: 'SEARCH_V2',
                                        },
                                        forceSelect: true,
                                        label: 'Existing identity',
                                        maximum: 1,
                                        required: false,
                                        helpText: 'Select the identity the account is part of',
                                        placeholder: null,
                                    },
                                    validations: [],
                                },
                            ],
                        ],
                        description: '',
                        label: 'Decisions',
                        labelStyle: 'h5',
                        showLabel: false,
                    },
                    validations: [],
                },
            ],
            label: 'Fusion decision',
            labelStyle: 'h3',
            showLabel: true,
        },
        validations: [],
    })

    // Candidate sections: one per candidate
    candidates.forEach((candidate) => {
        if (!candidate || !candidate.id || !candidate.name) return
        const candidateId = candidate.id
        const candidateElements: FormElementV2025[] = []

        if (fusionFormAttributes && fusionFormAttributes.length > 0) {
            fusionFormAttributes.forEach((attrName) => {
                const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
                const attrValue = candidate.attributes?.[attrName] ?? candidate.attributes?.[attrKey] ?? ''
                candidateElements.push({
                    id: `${candidateId}.${attrKey}`,
                    key: `${candidateId}.${attrKey}`,
                    elementType: 'TEXT',
                    config: {
                        label: capitalizeFirst(attrName),
                        default: String(attrValue),
                    },
                    validations: [],
                })
            })
        }

        // Add score section if scores exist
        if (candidate.scores && Array.isArray(candidate.scores) && candidate.scores.length > 0) {
            const scoreElements: FormElementV2025[] = []
            candidate.scores.forEach((score: any) => {
                if (!score || typeof score !== 'object') return
                if (score.type && score.value !== undefined) {
                    scoreElements.push({
                        id: `${candidateId}.${score.type}.score`,
                        key: `${candidateId}.${score.type}.score`,
                        elementType: 'TEXT',
                        config: {
                            label: `${capitalizeFirst(score.type)} score`,
                            default: String(score.value),
                        },
                        validations: [],
                    })
                    if (score.threshold !== undefined) {
                        scoreElements.push({
                            id: `${candidateId}.${score.type}.threshold`,
                            key: `${candidateId}.${score.type}.threshold`,
                            elementType: 'TEXT',
                            config: {
                                label: `${capitalizeFirst(score.type)} threshold`,
                                default: String(score.threshold),
                            },
                            validations: [],
                        })
                    }
                }
            })

            if (scoreElements.length > 0) {
                // Group scores in a COLUMN_SET if we have multiple
                if (scoreElements.length >= 2) {
                    const columns: FormElementV2025[][] = []
                    scoreElements.forEach((elem, index) => {
                        if (index % 2 === 0) {
                            columns.push([elem])
                        } else {
                            columns[columns.length - 1].push(elem)
                        }
                    })
                    candidateElements.push({
                        id: `${candidateId}.scoreSection`,
                        key: `${candidateId}.scoreSection`,
                        elementType: 'COLUMN_SET',
                        config: {
                            alignment: 'CENTER',
                            columnCount: 2,
                            columns: columns,
                            label: 'Score',
                            labelStyle: 'h5',
                            showLabel: true,
                        },
                        validations: [],
                    })
                } else {
                    candidateElements.push(...scoreElements)
                }
            }
        }

        // Add fusion score summary at the end (textarea, prefilled).
        // Using `default` ensures it renders; `description` alone may not show in the UI.
        if (candidate.scores && Array.isArray(candidate.scores) && candidate.scores.length > 0) {
            // ScoreReport shape: { attribute, algorithm, fusionScore (threshold), mandatory, score, isMatch, comment? }
            // Be defensive and also accept older shapes (value/threshold/type) if present.
            const scoreValues = candidate.scores
                .filter((s: any) => s && typeof s === 'object')
                .map((s: any) => Number(s?.score ?? s?.value))
                .filter((n: any) => Number.isFinite(n)) as number[]
            const averageScore =
                scoreValues.length > 0
                    ? (scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length).toFixed(1)
                    : 'N/A'

            const factorLines = candidate.scores
                .filter((s: any) => s && typeof s === 'object' && (s.score !== undefined || s.value !== undefined))
                .map((s: any) => {
                    const name = String(s.attribute ?? s.type ?? 'score')
                    const algorithmKey = String(s.algorithm ?? 'unknown')
                    const algorithm = ALGORITHM_LABELS[algorithmKey] ?? algorithmKey
                    const value = s.score !== undefined ? Number(s.score) : Number(s.value)
                    const thresholdRaw = s.fusionScore ?? s.threshold
                    const thresholdPart =
                        thresholdRaw !== undefined && thresholdRaw !== null
                            ? ` (threshold: ${String(thresholdRaw)}%)`
                            : ''
                    const matchPart =
                        s.isMatch !== undefined && s.isMatch !== null ? `, match: ${s.isMatch ? 'yes' : 'no'}` : ''
                    const commentPart = s.comment ? ` - ${String(s.comment)}` : ''
                    return `- ${name} [${algorithm}]: ${Number.isFinite(value) ? `${value}%` : String(s.score ?? s.value)}${thresholdPart}${matchPart}${commentPart}`
                })

            const summary = [
                `Average fusion score: ${averageScore}% (based on ${scoreValues.length} scoring factor(s))`,
                factorLines.length > 0 ? '' : undefined,
                factorLines.length > 0 ? 'Factors:' : undefined,
                ...factorLines,
            ]
                .filter((x): x is string => typeof x === 'string')
                .join('\n')

            candidateElements.push({
                id: `${candidateId}.scoreSummary`,
                key: `${candidateId}.scoreSummary`,
                // SailPoint forms support TEXTAREA element type; treated as free-form text input.
                // We prefill it so it acts like a read-only summary in practice.
                elementType: 'TEXTAREA' as any,
                config: {
                    label: 'Fusion Score Summary',
                    default: summary,
                    rows: 10,
                    resize: true,
                },
                validations: [],
            })
        }

        if (candidateElements.length > 0) {
            formFields.push({
                id: `${candidateId}.selectionsection`,
                key: `${candidateId}.selectionsection`,
                elementType: 'SECTION',
                config: {
                    alignment: 'CENTER',
                    formElements: candidateElements,
                    label: `${candidate.name} details`,
                    labelStyle: 'h4',
                    showLabel: true,
                },
                validations: [],
            })
        }
    })

    return formFields
}

/**
 * Build form conditions to hide candidate sections when appropriate
 * and disable all TEXT fields at all times
 */
export const buildFormConditions = (candidates: Candidate[], fusionFormAttributes?: string[]): any[] => {
    const formConditions: any[] = []

    // Validate inputs to prevent malformed conditions
    if (!candidates || !Array.isArray(candidates)) {
        return formConditions
    }

    // Disable all TEXT fields in the top section (new identity attributes)
    // Use a condition that's always true by checking newIdentity against itself
    if (fusionFormAttributes && fusionFormAttributes.length > 0) {
        fusionFormAttributes.forEach((attrName) => {
            const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
            formConditions.push({
                ruleOperator: 'AND',
                rules: [
                    {
                        sourceType: 'ELEMENT',
                        source: 'newIdentity',
                        operator: 'NE',
                        valueType: 'STRING',
                        value: '__NEVER_MATCH__',
                    },
                ],
                effects: [
                    {
                        effectType: 'DISABLE',
                        config: {
                            element: `newidentity.${attrKey}`,
                        },
                    },
                ],
            })
        })
    }

    // Disable all TEXT fields for candidate attributes and scores
    candidates.forEach((candidate) => {
        if (!candidate || !candidate.id) return
        const candidateId = candidate.id

        // Disable candidate attribute fields
        // Use a condition that's always true by checking newIdentity against an impossible value
        if (fusionFormAttributes && fusionFormAttributes.length > 0) {
            fusionFormAttributes.forEach((attrName) => {
                const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
                formConditions.push({
                    ruleOperator: 'AND',
                    rules: [
                        {
                            sourceType: 'ELEMENT',
                            source: 'newIdentity',
                            operator: 'NE',
                            valueType: 'STRING',
                            value: '__NEVER_MATCH__',
                        },
                    ],
                    effects: [
                        {
                            effectType: 'DISABLE',
                            config: {
                                element: `${candidateId}.${attrKey}`,
                            },
                        },
                    ],
                })
            })
        }

        // Disable score fields
        // Use a condition that's always true by checking newIdentity against an impossible value
        if (candidate.scores && Array.isArray(candidate.scores) && candidate.scores.length > 0) {
            candidate.scores.forEach((score: any) => {
                if (!score || typeof score !== 'object') return
                if (score.type && score.value !== undefined) {
                    formConditions.push({
                        ruleOperator: 'AND',
                        rules: [
                            {
                                sourceType: 'ELEMENT',
                                source: 'newIdentity',
                                operator: 'NE',
                                valueType: 'STRING',
                                value: '__NEVER_MATCH__',
                            },
                        ],
                        effects: [
                            {
                                effectType: 'DISABLE',
                                config: {
                                    element: `${candidateId}.${score.type}.score`,
                                },
                            },
                        ],
                    })

                    if (score.threshold !== undefined) {
                        formConditions.push({
                            ruleOperator: 'AND',
                            rules: [
                                {
                                    sourceType: 'ELEMENT',
                                    source: 'newIdentity',
                                    operator: 'NE',
                                    valueType: 'STRING',
                                    value: '__NEVER_MATCH__',
                                },
                            ],
                            effects: [
                                {
                                    effectType: 'DISABLE',
                                    config: {
                                        element: `${candidateId}.${score.type}.threshold`,
                                    },
                                },
                            ],
                        })
                    }
                }
            })

            // Disable scoreSummary TEXTAREA field
            // Use a condition that's always true by checking newIdentity against an impossible value
            formConditions.push({
                ruleOperator: 'AND',
                rules: [
                    {
                        sourceType: 'ELEMENT',
                        source: 'newIdentity',
                        operator: 'NE',
                        valueType: 'STRING',
                        value: '__NEVER_MATCH__',
                    },
                ],
                effects: [
                    {
                        effectType: 'DISABLE',
                        config: {
                            element: `${candidateId}.scoreSummary`,
                        },
                    },
                ],
            })
        }
    })

    // For each candidate, create a condition that hides its section when:
    // - newIdentity is true, OR
    // - identities is not equal to the candidate's displayName (form conditions use the label, not the value)
    candidates.forEach((candidate) => {
        if (!candidate || !candidate.id || !candidate.name) return
        formConditions.push({
            ruleOperator: 'OR',
            rules: [
                {
                    sourceType: 'ELEMENT',
                    source: 'newIdentity',
                    operator: 'EQ',
                    valueType: 'BOOLEAN',
                    value: 'true',
                },
                {
                    sourceType: 'ELEMENT',
                    source: 'identities',
                    operator: 'NE',
                    valueType: 'STRING',
                    value: candidate.name,
                },
            ],
            effects: [
                {
                    effectType: 'HIDE',
                    config: {
                        element: `${candidate.id}.selectionsection`,
                    },
                },
            ],
        })
    })

    return formConditions
}

/**
 * Build form inputs for fusion form definition
 */
export const buildFormInputs = (
    fusionAccount: FusionAccount,
    candidates: Candidate[],
    fusionFormAttributes?: string[]
): FormDefinitionInputV2025[] => {
    const formInputs: FormDefinitionInputV2025[] = []

    const accountIdentifier =
        String(fusionAccount.managedAccountId || '').trim() ||
        String(fusionAccount.nativeIdentityOrUndefined || '').trim() ||
        String((fusionAccount.attributes as any)?.id || '').trim() ||
        String((fusionAccount.attributes as any)?.uuid || '').trim() ||
        String(fusionAccount.identityId || '').trim() ||
        'unknown'

    // Account info
    formInputs.push({
        id: 'name',
        type: 'STRING',
        label: 'name',
        description:
            fusionAccount.name ||
            fusionAccount.displayName ||
            fusionAccount.nativeIdentityOrUndefined ||
            accountIdentifier,
    })
    formInputs.push({
        id: 'account',
        type: 'STRING',
        label: 'account',
        description: accountIdentifier,
    })
    formInputs.push({
        id: 'source',
        type: 'STRING',
        label: 'source',
        description: fusionAccount.sourceName,
    })

    // Decision inputs (bound to interactive elements)
    // NOTE: SDK only supports STRING / ARRAY for definition inputs. Toggle still binds to this key.
    // SELECT elements with dataSource don't need an input definition - they populate dynamically.
    formInputs.push({
        id: 'newIdentity',
        type: 'STRING',
        label: 'newIdentity',
        description: 'false',
    })

    // New identity attributes
    if (fusionFormAttributes && fusionFormAttributes.length > 0) {
        fusionFormAttributes.forEach((attrName) => {
            const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
            const attrValue = fusionAccount.attributes?.[attrName] || fusionAccount.attributes?.[attrKey] || ''
            formInputs.push({
                id: `newidentity.${attrKey}`,
                type: 'STRING',
                label: `newidentity.${attrKey}`,
                description: String(attrValue),
            })
        })
    }

    // Candidate attributes and scores
    candidates.forEach((candidate) => {
        if (!candidate || !candidate.id) return
        const candidateId = candidate.id

        if (fusionFormAttributes && fusionFormAttributes.length > 0) {
            fusionFormAttributes.forEach((attrName) => {
                const attrKey = attrName.charAt(0).toLowerCase() + attrName.slice(1)
                const attrValue = candidate.attributes?.[attrName] || candidate.attributes?.[attrKey] || ''
                formInputs.push({
                    id: `${candidateId}.${attrKey}`,
                    type: 'STRING',
                    label: `${candidateId}.${attrKey}`,
                    description: String(attrValue),
                })
            })
        }

        // Add score inputs
        if (candidate.scores && Array.isArray(candidate.scores) && candidate.scores.length > 0) {
            candidate.scores.forEach((score: any) => {
                if (!score || typeof score !== 'object') return
                if (score.type && score.value !== undefined) {
                    formInputs.push({
                        id: `${candidateId}.${score.type}.score`,
                        type: 'STRING',
                        label: `${candidateId}.${score.type}.score`,
                        description: String(score.value),
                    })
                    if (score.threshold !== undefined) {
                        formInputs.push({
                            id: `${candidateId}.${score.type}.threshold`,
                            type: 'STRING',
                            label: `${candidateId}.${score.type}.threshold`,
                            description: String(score.threshold),
                        })
                    }
                }
            })
        }
    })

    return formInputs
}
