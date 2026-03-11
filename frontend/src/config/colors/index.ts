/**
 * Color System - Central Exports
 *
 * Import all color-related utilities from this file.
 */

// Primitive colors
export {
    NEUTRAL_COLORS,
    FEEDBACK_COLORS,
    type GroupId,
} from './palette';

// Semantic tokens
export {
    getSemanticColors,
    UI_TOKENS,
    type SemanticColors,
} from './semantic';

// CSS variable utilities
export {
    CSS_VAR_NAMES,
    generateThemeCSSVariables,
    applyThemeToDocument,
    clearThemeFromDocument,
    serviceIdToGroupId,
    isGroupId,
} from './css-variables';
