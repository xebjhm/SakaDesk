/** The five text sizes (font-size / line-height). */
export const typeScale = {
    caption: { size: '11px', leading: '16px' },
    small: { size: '13px', leading: '20px' },
    body: { size: '14px', leading: '22px' },
    title: { size: '16px', leading: '24px' },
    heading: { size: '20px', leading: '28px' },
    /** Long-form reading only (blog posts): 16 px with a 28 px line for Japanese text. */
    reading: { size: '16px', leading: '28px' },
} as const;

export type TypeStep = keyof typeof typeScale;

/** Font families beyond the default sans (Noto Sans JP). Both load from Google Fonts in index.html. */
export const fontFamily = {
    /** Blog titles only (feed, cards, post, rail tooltip); post bodies stay in the sans. */
    reading: '"Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif',
} as const;
