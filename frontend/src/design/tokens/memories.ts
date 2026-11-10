/**
 * The Memories keepsake surfaces (DESIGN_SYSTEM.md "Memories keepsake surfaces"): the paper,
 * cork, tape and foil a fan's keepsakes sit on, and the sepia that ages a photo by its year.
 * Neutral materials only; nothing here follows the group accent.
 */
import { aurora } from './brand';
import { color } from './color';

const [sky, lavender, pink, peach] = aurora.stops;

export const memories = {
    /**
     * `filter: sepia(n)` strengths by age (`shared/sepia.ts`): 1 = last year, 2 = two years ago,
     * 3 = three or more. This year stays in colour.
     */
    sepia: { 1: '0.25', 2: '0.45', 3: '0.65' },
    /** Letter and polaroid white: a warm paper, never pure white, and its hairline edge. */
    paper: '#fffdf8',
    paperLine: 'rgba(120, 96, 64, 0.14)',
    /** The favourites cork board base: a warm cork, lit from the top left. */
    cork: 'linear-gradient(135deg, #d8b98f 0%, #c9a274 55%, #bf9666 100%)',
    /** Translucent washi tape that pins a polaroid. */
    washi: 'rgba(250, 236, 214, 0.72)',
    /** The holographic sheen of a special (foil) card, built from the aurora stops. */
    foil: `linear-gradient(115deg, ${sky} 0%, ${lavender} 25%, ${pink} 50%, ${peach} 75%, ${sky} 100%)`,
    shadow: {
        /** A polaroid lying on a surface: a tight contact shadow and a soft drop. */
        polaroid: '0 1px 2px rgba(0, 0, 0, 0.08), 0 10px 22px -8px rgba(0, 0, 0, 0.24)',
    },
    /** The dashed outline of an unearned card (a silhouette): the neutral `border-strong`. */
    silhouette: color.border.strong,
} as const;
