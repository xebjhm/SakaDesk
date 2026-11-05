/**
 * SakaDesk's own brand (design language v2, spec §3.1). Solid UI uses the ink
 * scale; expressive surfaces use the aurora. Used in brand context only.
 */
import type { ScaleStep } from './groups';

export const brandInk: Record<ScaleStep, string> = {
    50: '#f4f7fc', 100: '#e9eef7', 200: '#d5deee', 300: '#bac8e0', 400: '#9dafce',
    500: '#8296b9', 600: '#63769a', 700: '#4d5e7d', 800: '#3a4860', 900: '#293345',
};

export const aurora = {
    /** Sky → lavender → pink → peach. Text on it is always dark. */
    gradient: 'linear-gradient(120deg, #cfe6ff 0%, #e3dcff 38%, #ffdcea 72%, #fff0dc 100%)',
    /** The three L2 orb colours in brand context. */
    orbs: ['#bfdcff', '#ffd0e4', '#e2d6ff'] as const,
} as const;

/** Ink 500 at 0.35: the brand L1 glow. */
export const brandGlow = 'rgba(130, 150, 185, 0.35)';
/** Ink 400 at 0.4: the brand unread glow. */
export const brandUnread = '0 0 12px rgba(157, 175, 206, 0.4)';
