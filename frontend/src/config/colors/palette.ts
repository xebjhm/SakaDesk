/**
 * Legacy neutral palette (pre-D1 API).
 *
 * Values now come from `design/tokens/color.ts`, the single source. New code
 * imports `design/tokens` directly; D2 deletes this file with its last caller.
 */
import { color } from '../../design/tokens/color';

export type { GroupId } from '../serviceThemes';

export const NEUTRAL_COLORS = {
    surface: {
        base: color.surface.sheet,
        elevated: color.surface.elevated,
        sunken: color.surface.sunken,
    },
    text: color.text,
    border: {
        light: color.border.subtle,
        base: color.border.strong,
    },
} as const;

export const FEEDBACK_COLORS = {
    success: color.semantic.success.solid,
    warning: color.semantic.warning.solid,
    error: color.semantic.danger.solid,
} as const;
