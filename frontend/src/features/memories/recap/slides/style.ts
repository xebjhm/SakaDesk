/** Type classes and the reveal motion of the recap slides (see `common.tsx` for the voices). */
import type React from 'react';

/** Her words: serif display. */
export const QUOTE_CLASS = 'font-display text-heading font-medium';
/**
 * A slide's title (app copy): serif display (`font-display`, the UI language's Noto Serif), the
 * heading size, semibold. Never marked `lang="ja"`: it is the app speaking, not her.
 */
export const TITLE_CLASS = 'font-display text-heading font-semibold';
/** App narration: smaller sans, so it never reads as her words. */
export const NARRATION_CLASS = 'font-sans text-small';

/** `animate-reveal` with an optional stagger, or nothing with reduced motion. */
export function reveal(reducedMotion: boolean, delayMs = 0): { className: string; style?: React.CSSProperties } {
    if (reducedMotion) return { className: '' };
    return {
        className: 'animate-reveal motion-reduce:animate-none',
        style: delayMs ? { animationDelay: `${delayMs}ms`, animationFillMode: 'both' } : undefined,
    };
}
