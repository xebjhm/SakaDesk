/** The five text sizes (font-size / line-height). */
export const typeScale = {
    caption: { size: '11px', leading: '16px' },
    small: { size: '13px', leading: '20px' },
    body: { size: '14px', leading: '22px' },
    title: { size: '16px', leading: '24px' },
    heading: { size: '20px', leading: '28px' },
} as const;

export type TypeStep = keyof typeof typeScale;
