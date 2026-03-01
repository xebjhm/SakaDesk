/**
 * CSS Variable Generation and Application
 *
 * Generates CSS custom properties from theme colors and applies them to the document.
 * This enables runtime theme switching without JavaScript re-renders.
 */

import { BRAND_COLORS, type GroupId } from './palette';
import { getSemanticColors, UI_TOKENS } from './semantic';

/**
 * Map service IDs to GroupIds.
 * e.g., "hinatazaka46" -> "hinatazaka"
 */
const SERVICE_TO_GROUP: Record<string, GroupId> = {
    'hinatazaka46': 'hinatazaka',
    'sakurazaka46': 'sakurazaka',
    'nogizaka46': 'nogizaka',
    'yodel': 'yodel',
};

/**
 * Convert a service ID to a GroupId.
 * Returns 'hinatazaka' as default if no mapping found.
 */
export function serviceIdToGroupId(serviceId: string): GroupId {
    return SERVICE_TO_GROUP[serviceId] ?? 'hinatazaka';
}

/**
 * Check if a string is a valid GroupId.
 */
export function isGroupId(value: string): value is GroupId {
    return value in BRAND_COLORS;
}

/**
 * CSS variable names for theme colors.
 */
export const CSS_VAR_NAMES = {
    // Group-specific colors
    primary: '--color-primary',
    secondary: '--color-secondary',
    accent: '--color-accent',
    gradientFrom: '--color-gradient-from',
    gradientTo: '--color-gradient-to',
    // UI surfaces
    surfaceBase: '--color-surface-base',
    surfaceElevated: '--color-surface-elevated',
    surfaceSunken: '--color-surface-sunken',
    // Text
    textPrimary: '--color-text-primary',
    textSecondary: '--color-text-secondary',
    textMuted: '--color-text-muted',
    textInverse: '--color-text-inverse',
    // Feedback
    success: '--color-success',
    warning: '--color-warning',
    error: '--color-error',
} as const;

/**
 * Generate CSS variable declarations for a group theme.
 */
export function generateThemeCSSVariables(groupId: GroupId): Record<string, string> {
    const semantic = getSemanticColors(groupId);

    return {
        [CSS_VAR_NAMES.primary]: semantic.primary,
        [CSS_VAR_NAMES.secondary]: semantic.secondary,
        [CSS_VAR_NAMES.accent]: semantic.accent,
        [CSS_VAR_NAMES.gradientFrom]: semantic.gradientFrom,
        [CSS_VAR_NAMES.gradientTo]: semantic.gradientTo,
        // UI tokens (same for all themes)
        [CSS_VAR_NAMES.surfaceBase]: UI_TOKENS.surface.base,
        [CSS_VAR_NAMES.surfaceElevated]: UI_TOKENS.surface.elevated,
        [CSS_VAR_NAMES.surfaceSunken]: UI_TOKENS.surface.sunken,
        [CSS_VAR_NAMES.textPrimary]: UI_TOKENS.text.primary,
        [CSS_VAR_NAMES.textSecondary]: UI_TOKENS.text.secondary,
        [CSS_VAR_NAMES.textMuted]: UI_TOKENS.text.muted,
        [CSS_VAR_NAMES.textInverse]: UI_TOKENS.text.inverse,
        [CSS_VAR_NAMES.success]: UI_TOKENS.feedback.success,
        [CSS_VAR_NAMES.warning]: UI_TOKENS.feedback.warning,
        [CSS_VAR_NAMES.error]: UI_TOKENS.feedback.error,
    };
}

/**
 * Apply theme CSS variables to the document root.
 * Call this when the active service/group changes.
 */
export function applyThemeToDocument(groupId: GroupId): void {
    const variables = generateThemeCSSVariables(groupId);
    const root = document.documentElement;

    for (const [name, value] of Object.entries(variables)) {
        root.style.setProperty(name, value);
    }
}

/**
 * Remove theme CSS variables from the document root.
 */
export function clearThemeFromDocument(): void {
    const root = document.documentElement;

    for (const name of Object.values(CSS_VAR_NAMES)) {
        root.style.removeProperty(name);
    }
}
