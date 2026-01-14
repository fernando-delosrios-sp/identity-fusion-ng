import { transliterate } from 'transliteration'
import velocityjs from 'velocityjs'
import { RenderContext } from 'velocityjs/dist/src/type'
import * as Datefns from 'date-fns'
import { LogService } from '../logService'

/**
 * Normalize string by transliterating and removing special characters
 */
export const normalize = (str: string): string => {
    let result = transliterate(str)
    result = result.replace(/'/g, '')

    return result
}

/**
 * Remove all spaces from a string
 */
export const removeSpaces = (str: string): string => {
    return str.replace(/\s/g, '')
}

/**
 * Transform string case based on caseType
 */
export const switchCase = (str: string, caseType: 'lower' | 'upper' | 'capitalize' | 'same'): string => {
    switch (caseType) {
        case 'lower':
            return str.toLowerCase()
        case 'upper':
            return str.toUpperCase()
        case 'capitalize':
            return str
                .split(' ')
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ')
        default:
            return str
    }
}

/**
 * Evaluate Velocity template expression with extended context (Math, Date, Datefns)
 */
export const evaluateVelocityTemplate = (
    expression: string,
    context: RenderContext,
    maxLength?: number,
    log?: LogService
): string | undefined => {
    const extendedContext: RenderContext = { ...context, Math, Date, Datefns }
    if (log) {
        log.debug(`Evaluating velocity template - expression: ${expression}`)
    }

    const template = velocityjs.parse(expression)
    const velocity = new velocityjs.Compile(template)
    let result = velocity.render(extendedContext)
    if (maxLength && result.length > maxLength) {
        if (extendedContext.counter && extendedContext.counter !== '') {
            if (expression.endsWith('$counter') || expression.endsWith('${counter}')) {
                const originalCounter = extendedContext.counter
                const originalCounterLength = originalCounter.toString().length
                result = result.substring(0, maxLength - originalCounterLength) + originalCounter
            } else {
                if (log) {
                    log.error(
                        `Counter variable is not found at the end of the expression: ${expression}. Cannot truncate the result to the maximum length.`
                    )
                }
            }
        } else {
            result = result.substring(0, maxLength)
        }
    }

    if (log) {
        log.debug(`Velocity template evaluation result: ${result}`)
    }
    return result
}

/**
 * Check if a Velocity template expression contains a specific variable
 */
export const templateHasVariable = (expression: string, variable: string, log?: LogService): boolean => {
    if (log) {
        log.debug(`Checking if template contains variable: ${variable} in expression: ${expression}`)
    }
    const template = velocityjs.parse(expression)
    const hasVariable = template.find((x) => (x as any).id === variable) ? true : false
    if (log) {
        log.debug(`Template variable check result - variable: ${variable}, found: ${hasVariable}`)
    }
    return hasVariable
}

/**
 * Pad a number with leading zeros to reach the specified length
 */
export const padNumber = (number: number, length: number): string => {
    const numStr = number.toString()
    return numStr.length < length ? numStr.padStart(length, '0') : numStr
}
