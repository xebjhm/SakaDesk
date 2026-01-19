/**
 * Brand Color Palette - Single Source of Truth
 *
 * All brand colors for each idol group are defined here.
 * Other color files (themes, services) should import from this file.
 */

/**
 * Primary brand colors for each Sakamichi group.
 * These are the canonical colors that define each group's visual identity.
 */
export const BRAND_COLORS = {
    hinatazaka: {
        /** Sorairo (Sky Blue) - primary brand color */
        primary: '#7cc7e8',
        /** Darker sky blue for gradients */
        primaryDark: '#5eb3d8',
        /** Teal - secondary accent */
        secondary: '#5dc2b5',
        /** Soft sunlight yellow */
        accent: '#fffacd',
    },
    sakurazaka: {
        /** Official Sakura Pink - primary brand color */
        primary: '#E85298',
        /** Lighter cherry blossom pink */
        primaryLight: '#f7a6c9',
        /** Darker rose for gradients */
        primaryDark: '#d4729c',
        /** Pure white - secondary color */
        secondary: '#FFFFFF',
        /** Cool grey-blue accent */
        accent: '#8B9DC3',
    },
    nogizaka: {
        /** Noble Purple - primary brand color */
        primary: '#7e1083',
        /** Soft purple for lighter contexts */
        primaryLight: '#9B59B6',
        /** Darker noble purple for gradients */
        primaryDark: '#5a0b5e',
        /** Soft purple - secondary color */
        secondary: '#9B59B6',
        /** Misty lavender accent */
        accent: '#E8E0F0',
    },
} as const;

/**
 * Neutral colors for UI elements (not group-specific).
 * Use these for backgrounds, text, and borders.
 */
export const NEUTRAL_COLORS = {
    /** Surface colors for backgrounds and cards */
    surface: {
        white: '#FFFFFF',
        offWhite: '#FAFAFA',
        gray50: '#F9FAFB',
        gray100: '#F3F4F6',
        gray200: '#E5E7EB',
        gray300: '#D1D5DB',
    },
    /** Text colors */
    text: {
        primary: '#1f2937',    // gray-800
        secondary: '#4b5563',  // gray-600
        muted: '#9ca3af',      // gray-400
        inverse: '#FFFFFF',
    },
    /** Border colors */
    border: {
        light: '#e5e7eb',      // gray-200
        base: '#d1d5db',       // gray-300
    },
    /** Dark theme colors (for rails and menus) */
    dark: {
        bg: '#1e1f22',
        bgLight: '#2b2d31',
        bgLighter: '#313338',
        bgHover: '#35373c',
        bgActive: '#404249',
    },
} as const;

/**
 * Semantic feedback colors (not group-specific).
 */
export const FEEDBACK_COLORS = {
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
} as const;

export type GroupId = keyof typeof BRAND_COLORS;
