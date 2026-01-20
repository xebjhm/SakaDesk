/**
 * Semantic Color Tokens
 *
 * Maps brand colors to semantic meanings for consistent UI theming.
 * Use these tokens in components instead of raw color values.
 */

import { BRAND_COLORS, NEUTRAL_COLORS, FEEDBACK_COLORS, type GroupId } from './palette';

/**
 * Semantic color roles for a group theme.
 */
export interface SemanticColors {
    /** Primary brand color for headers, buttons, and accents */
    primary: string;
    /** Secondary color for supporting elements */
    secondary: string;
    /** Accent color for highlights and decorations */
    accent: string;
    /** Gradient start color (lighter) */
    gradientFrom: string;
    /** Gradient end color (darker) */
    gradientTo: string;
}

/**
 * Get semantic colors for a specific group.
 */
export function getSemanticColors(groupId: GroupId): SemanticColors {
    switch (groupId) {
        case 'hinatazaka': {
            const brand = BRAND_COLORS.hinatazaka;
            return {
                primary: brand.primary,
                secondary: brand.secondary,
                accent: brand.accent,
                gradientFrom: brand.primary,
                gradientTo: brand.primaryDark,
            };
        }
        case 'sakurazaka': {
            const brand = BRAND_COLORS.sakurazaka;
            return {
                primary: brand.primary,
                secondary: brand.secondary,
                accent: brand.accent,
                gradientFrom: brand.primaryLight,
                gradientTo: brand.primary,
            };
        }
        case 'nogizaka': {
            const brand = BRAND_COLORS.nogizaka;
            return {
                primary: brand.primary,
                secondary: brand.secondary,
                accent: brand.accent,
                gradientFrom: brand.primary,
                gradientTo: brand.primaryDark,
            };
        }
    }
}

/**
 * UI semantic tokens (group-independent).
 */
export const UI_TOKENS = {
    /** Surface colors for different elevation levels */
    surface: {
        base: NEUTRAL_COLORS.surface.white,
        elevated: NEUTRAL_COLORS.surface.offWhite,
        sunken: NEUTRAL_COLORS.surface.gray100,
    },
    /** Text colors by importance */
    text: NEUTRAL_COLORS.text,
    /** Border colors */
    border: NEUTRAL_COLORS.border,
    /** Dark mode surfaces */
    dark: NEUTRAL_COLORS.dark,
    /** Feedback states */
    feedback: FEEDBACK_COLORS,
} as const;
