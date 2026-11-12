/**
 * SakaDesk's own brand (design language v2, spec §3.1). Solid UI uses the ink
 * scale; expressive surfaces use the aurora. Used in brand context only.
 */
import type { ScaleStep } from './groups';

export const brandInk: Record<ScaleStep, string> = {
    50: '#f4f7fc', 100: '#e9eef7', 200: '#d5deee', 300: '#bac8e0', 400: '#9dafce',
    500: '#8296b9', 600: '#63769a', 700: '#4d5e7d', 800: '#3a4860', 900: '#293345',
};

/** The aurora's four colour stops: sky, lavender, pink, peach. */
const AURORA_STOPS = ['#cfe6ff', '#e3dcff', '#ffdcea', '#fff0dc'] as const;

export const aurora = {
    /** Sky → lavender → pink → peach. Text on it is always dark. */
    gradient: `linear-gradient(120deg, ${AURORA_STOPS[0]} 0%, ${AURORA_STOPS[1]} 38%, ${AURORA_STOPS[2]} 72%, ${AURORA_STOPS[3]} 100%)`,
    /** The gradient's stops, for surfaces built from them (the Memories foil). */
    stops: AURORA_STOPS,
    /** The three L2 orb colours in brand context. */
    orbs: ['#bfdcff', '#ffd0e4', '#e2d6ff'] as const,
} as const;

/** Ink 500 at 0.35: the brand L1 glow. */
export const brandGlow = 'rgba(130, 150, 185, 0.35)';
/** Ink 400 at 0.4: the brand unread glow. */
export const brandUnread = '0 0 12px rgba(157, 175, 206, 0.4)';
