/** Spinner class maps, shared by `Spinner` and `StatusBlock` (kept apart so both files only export components). */
export type SpinnerSize = 'sm' | 'md' | 'lg';
export type SpinnerLabelVisibility = 'auto' | 'always' | 'compact';

/** h-4 / h-6 / h-8 (and the same width). */
export const SPINNER_SIZE: Record<SpinnerSize, string> = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' };

/**
 * Label classes per visibility. auto: screen-reader only, visible under reduced motion;
 * always: visible; compact: screen-reader only always (media tiles and bubbles under 160 px only).
 */
export const SPINNER_LABEL_VISIBILITY: Record<SpinnerLabelVisibility, string> = {
    auto: 'sr-only motion-reduce:not-sr-only',
    always: '',
    compact: 'sr-only',
};
