/** Corner radius, one step per visual level (background has none). */
export const radius = {
    none: '0px',
    /** Only the first bubble of a run: its small top-left corner (`rounded-tl-tail`). */
    tail: '4px',
    card: '14px',
    sheet: '20px',
    pill: '9999px',
} as const;

export type RadiusStep = keyof typeof radius;
