/**
 * Corner radius, 6 steps (design language v2, spec §7). Buttons are `md`; `full` is only
 * for tag-like items (date pill, filters, badges, avatars, switches). Nested boxes use
 * concentric radii: inner = outer − padding, never below `xs`.
 */
const steps = {
    none: '0px',
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    full: '9999px',
} as const;

export const radius = {
    ...steps,
    /** @deprecated D1 name → `xs` (bubble tail corner). */
    tail: steps.xs,
    /** @deprecated D1 name → `lg`. */
    card: steps.lg,
    /** @deprecated D1 name → `xl`. */
    sheet: steps.xl,
    /** @deprecated D1 name → `full`. */
    pill: steps.full,
} as const;

export type RadiusStep = keyof typeof radius;
