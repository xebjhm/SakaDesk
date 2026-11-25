/** Type classes and the reveal motion of the recap slides (see `common.tsx` for the voices). */
import type React from 'react';

/**
 * A slide's title (app copy): serif display (`font-display`, the UI language's Noto Serif), the
 * heading size, semibold. Never marked `lang="ja"`: it is the app speaking, not her.
 */
export const TITLE_CLASS = 'font-display text-heading font-semibold';

/** `animate-reveal` with an optional stagger, or nothing with reduced motion. */
export function reveal(reducedMotion: boolean, delayMs = 0): { className: string; style?: React.CSSProperties } {
    if (reducedMotion) return { className: '' };
    return {
        className: 'animate-reveal motion-reduce:animate-none',
        style: delayMs ? { animationDelay: `${delayMs}ms`, animationFillMode: 'both' } : undefined,
    };
}

/**
 * Holds a slide's CSS animations while the player is paused (Space or the pause button), so a
 * scroll, a fall or a reveal never runs on behind a paused story. Merge it into the element's style.
 */
export function playState(paused: boolean): React.CSSProperties {
    return { animationPlayState: paused ? 'paused' : 'running' };
}

/** `reveal` that also holds while paused. */
export function heldReveal(reducedMotion: boolean, paused: boolean, delayMs = 0): { className: string; style?: React.CSSProperties } {
    const r = reveal(reducedMotion, delayMs);
    if (reducedMotion) return r;
    return { className: r.className, style: { ...r.style, ...playState(paused) } };
}
