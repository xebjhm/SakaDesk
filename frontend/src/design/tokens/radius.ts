/** Corner radius, one step per visual level (background has none). */
export const radius = {
    none: '0px',
    card: '14px',
    sheet: '20px',
    pill: '9999px',
} as const;

export type RadiusStep = keyof typeof radius;
