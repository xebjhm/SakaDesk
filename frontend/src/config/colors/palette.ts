/**
 * Primitive Color Palette
 *
 * Neutral and feedback colors (theme-independent).
 * Brand colors are defined in serviceThemes.ts (the single source of truth).
 */

export type { GroupId } from '../serviceThemes';

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
