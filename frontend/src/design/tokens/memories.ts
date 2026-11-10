/**
 * The Memories keepsake surfaces (DESIGN_SYSTEM.md "Memories keepsake surfaces"): the paper,
 * cork, tape and foil a fan's keepsakes sit on, and the sepia that ages a photo by its year;
 * and the fun wave's semantic surfaces (gacha rarity, the radio night and its on-air lamp, the
 * 24h sky, the capsule note). Nothing here follows the group accent, and none of it reuses the
 * oshi pink, the favourite star yellow or danger red.
 */
import { aurora, brandInk } from './brand';
import { color } from './color';

const [sky, lavender, pink, peach] = aurora.stops;

/** The SR gold: a warm antique gold, well apart from the favourite star's yellow-400. */
const GOLD = '#d4a24c';
/** The radio's deepest night (top of the night gradient). */
const MIDNIGHT = '#141b33';

export const memories = {
    /**
     * `filter: sepia(n)` strengths by age (`shared/sepia.ts`): 1 = last year, 2 = two years ago,
     * 3 = three or more. This year stays in colour. Step 3 is full sepia: it is also the recap
     * S08 older card's approved look (formerly Tailwind's plain `sepia`).
     */
    sepia: { 1: '0.35', 2: '0.65', 3: '1' },
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
    /**
     * Gacha rarity (spec 12): `n` the neutral `border-strong`, `r` a warm rose gold (hue well away
     * from the magenta oshi pink), `sr` the foil's gold (a gold sheen through the aurora peach stop).
     * Fills only: text on them uses the ordinary dark text roles.
     */
    rarity: {
        n: color.border.strong,
        r: '#c08a72',
        sr: `linear-gradient(135deg, ${GOLD} 0%, ${peach} 50%, ${GOLD} 100%)`,
    },
    /** The radio's night surface (spec 11): deep navy down into the brand ink, lit by the aurora lavender. */
    night: `linear-gradient(180deg, ${MIDNIGHT} 0%, ${brandInk[900]} 65%, color-mix(in srgb, ${lavender} 12%, ${brandInk[900]}) 100%)`,
    /** Text on the night surface: the aurora sky stop. */
    nightInk: sky,
    /**
     * The ON AIR lamp: a warm red-orange indicator, not an error (apart from danger red). Non-text
     * only (a lamp dot or glyph on the night surface, >= 3:1 there): never text colour.
     */
    onAir: '#ff6b47',
    /** 彼女の24時間's sky, top to bottom: dawn (peach), day (sky), dusk, night. */
    sky: `linear-gradient(180deg, ${peach} 0%, ${sky} 35%, #f2b98f 70%, ${brandInk[800]} 100%)`,
    /** A capsule sticky note: a warm paper yellow, apart from the favourite star and the letter paper. */
    note: '#fbefc4',
} as const;
