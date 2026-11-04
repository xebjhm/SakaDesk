/**
 * Neutral colour tokens, named by role (never by hue) so a dark set can be
 * added later as a second value map. Values are copied verbatim from the
 * pre-D1 palette; `legacy-theme-values.json` pins them.
 */
export const color = {
    surface: {
        /** Level 1 sheet (content area). */
        sheet: '#FFFFFF',
        /** Level 2 card (photos, info cards, bubbles). */
        card: '#FFFFFF',
        /** Level 3 pill (tabs, filters, dates). */
        pill: '#FFFFFF',
        /** Slightly raised neutral, e.g. hover backgrounds. */
        elevated: '#FAFAFA',
        /** Recessed neutral, e.g. avatar placeholder, selected pill. */
        sunken: '#F3F4F6',
    },
    text: {
        primary: '#1f2937',
        secondary: '#4b5563',
        muted: '#9ca3af',
        inverse: '#FFFFFF',
    },
    border: {
        subtle: '#e5e7eb',
        strong: '#d1d5db',
    },
    overlay: {
        /** Dimmed backdrop behind modals. Carries its own alpha (token colours cannot take Tailwind opacity modifiers). */
        scrim: 'rgba(0, 0, 0, 0.4)',
    },
    feedback: {
        success: '#10B981',
        warning: '#F59E0B',
        error: '#EF4444',
    },
    /** Search matches inside text (blog reader): exact match, match by reading, and its dashed underline. Values from the pre-D2b reader. */
    mark: {
        exact: '#FEF08A',
        reading: '#DBEAFE',
        underline: '#60A5FA',
    },
} as const;
