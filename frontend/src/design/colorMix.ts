/**
 * Inline-style colour helpers for the pre-token media components (voice player, transcript,
 * translate/transcribe buttons), which mix their accent with transparency in inline styles.
 * They take a CSS variable instead of a hex, so the accent follows the context
 * (docs/design/DESIGN_SYSTEM.md, "Accent roles"). New components use utilities instead.
 */
export const ACCENT = 'var(--ds-accent)';
export const ACCENT_LOGO = 'var(--ds-accent-logo)';

/** `colour` at `percent` % opacity; works with hex and with var(). */
export function withAlpha(colour: string, percent: number): string {
    return `color-mix(in srgb, ${colour} ${percent}%, transparent)`;
}
