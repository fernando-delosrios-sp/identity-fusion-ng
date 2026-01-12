// Re-export main service class
export { AttributeService } from './attributeService'

// Re-export constants (maintaining backward compatibility with lowercase export)
export { COMPOUND_KEY_UNIQUE_ID_ATTRIBUTE } from './constants'
import { COMPOUND_KEY_UNIQUE_ID_ATTRIBUTE } from './constants'
export const compoundKeyUniqueIdAttribute = COMPOUND_KEY_UNIQUE_ID_ATTRIBUTE

// Re-export helper functions that are used externally
export { attrConcat } from './helpers'

// Re-export StateWrapper
export { StateWrapper } from './stateWrapper'
