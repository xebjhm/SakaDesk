/** Elevation, one layer per visual level. */
export const shadow = {
    none: 'none',
    /** Level 3: tabs, filters, dates, badges. */
    pill: '0 1px 2px rgba(15, 23, 42, 0.06)',
    /** Level 2: cards, bubbles, photos. */
    card: '0 2px 8px rgba(15, 23, 42, 0.08)',
    /** Level 1: the content sheet and modals. */
    sheet: '0 12px 40px rgba(15, 23, 42, 0.12)',
} as const;

export type ShadowStep = keyof typeof shadow;
