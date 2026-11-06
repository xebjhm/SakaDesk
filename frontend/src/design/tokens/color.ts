import { brandInk } from './brand';

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
        /** The window base behind the app (root, boot screen); matches pywebview's background_color and index.css. */
        window: '#F0F2F5',
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
        /** Toasts (viewer clipboard, About). The pre-D2c `bg-black/80`. */
        toast: 'rgba(0, 0, 0, 0.8)',
        /** Unread pill on a gradient chat header: the pre-D2 white glass. */
        glass: 'rgba(255, 255, 255, 0.2)',
        /** Sync pill on a gradient chat header: the pre-D2 dark shade. */
        shade: 'rgba(0, 0, 0, 0.2)',
    },
    /**
     * Semantic colours (v2, harmonized ~35 % below signal chroma). Global: they never follow
     * context. subtle = banner bg, icon = icon circle bg, border = outline, solid = destructive
     * fill (white text >= 4.5:1), text = text and glyphs (>= 4.5:1 on white). Info is the brand ink.
     */
    semantic: {
        success: { subtle: '#f0fbf4', icon: '#e3f6ea', border: '#cae8d7', solid: '#2e805a', text: '#216a49' },
        warning: { subtle: '#fff5ed', icon: '#feedde', border: '#f6dac3', solid: '#9b5e1e', text: '#824c13' },
        danger: { subtle: '#fff3f1', icon: '#ffe7e4', border: '#ffd1cd', solid: '#b44543', text: '#963635' },
        info: { subtle: brandInk[50], icon: brandInk[100], border: brandInk[200], solid: brandInk[600], text: brandInk[700] },
    },
    /** Search matches inside text (blog reader): exact match, match by reading, and its dashed underline. Values from the pre-D2b reader. */
    mark: {
        exact: '#FEF08A',
        reading: '#DBEAFE',
        underline: '#60A5FA',
    },
    /** The dark photo/video viewer's chrome (D2c). Values are the pre-D2c viewer's. */
    viewer: {
        scrim: 'rgba(0, 0, 0, 0.9)',
        stage: '#000000',
        control: 'rgba(255, 255, 255, 0.2)',
        controlHover: 'rgba(255, 255, 255, 0.3)',
        text: '#FFFFFF',
        textMuted: 'rgba(255, 255, 255, 0.7)',
        underline: 'rgba(255, 255, 255, 0.3)',
    },
    /** Decorations kept from the pre-D2c look: calendar Sundays, About's heart. */
    decor: {
        sunday: '#EF4444',
        heart: '#F87171',
    },
} as const;
