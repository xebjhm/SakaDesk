/**
 * Per-group colour data — the ONLY place group colours are defined.
 *
 * Two layers (docs/design/DESIGN_SYSTEM.md, "Colour system"):
 * - `official`: colours copied from the official apps. They are kept verbatim
 *   and pinned by tests: title gradient/bar/text, canvas, unread shelters and
 *   styles.
 * - System: `logo` plus a 10-step `scale` (OKLCH, logo colour snapped into its
 *   nearest step). Every other colour is a role from `roles.ts`, never a hex
 *   written here.
 * `legacyNeutral` holds today's per-group neutral tints, which D2 replaces
 * with shared neutrals.
 */
export type GroupId = 'hinatazaka' | 'sakurazaka' | 'nogizaka' | 'yodel' | 'default';

export const GROUP_IDS: readonly GroupId[] = ['hinatazaka', 'sakurazaka', 'nogizaka', 'yodel', 'default'];

/** Groups whose logos carry the shared Sakamichi purple. */
export const SAKAMICHI_GROUPS: readonly GroupId[] = ['hinatazaka', 'sakurazaka', 'nogizaka'];

/** The purple shared by every Sakamichi logo, and its tint used by the ambient orbs. */
export const SAKAMICHI_PURPLE = { base: '#7f1083', 100: '#fce4fc' } as const;

export type ScaleStep = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export const SCALE_STEPS: readonly ScaleStep[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

export interface OfficialLayer {
    title: {
        /** Chat/blog title gradient. */
        gradient: { from: string; via: string; to: string };
        /** Thin gradient bar under the title. */
        bar: string;
        /** Title text colour on light headers. */
        text: string;
    };
    /** Level-0 background (sidebar) gradient stops, top to bottom. */
    canvas: readonly [string, string, string];
    /** Unread-message cover colours per message type. */
    shelter: { picture: string; video: string; voice: string; text: string };
    /** 'classic' = coloured cover + white icon; 'light' = white cover + coloured icon. */
    shelterStyle: 'classic' | 'light';
    /** 'gradient' = filled gradient header + white text; 'light' = white header + coloured text. */
    headerStyle: 'gradient' | 'light';
}

export interface GroupTokens {
    /** The logo colour; it is also one step of `scale`. */
    logo: string;
    scale: Record<ScaleStep, string>;
    /** Message bubble border: the logo colour, or step 600 when the logo is too dark. */
    bubbleBorder: string;
    /** Selection glow: the logo colour at the group's alpha. */
    glow: string;
    official: OfficialLayer;
    legacyNeutral: { surfaceBackground: string; textSecondary: string; textMuted: string };
}

export const groupTokens: Record<GroupId, GroupTokens> = {
    hinatazaka: {
        logo: '#7cc7e8',
        scale: {
            50: '#eff9fd', 100: '#dbf1fb', 200: '#bbe4f7', 300: '#7cc7e8', 400: '#62bce2',
            500: '#50acdf', 600: '#389dd1', 700: '#0d7aab', 800: '#025c83', 900: '#03425f',
        },
        bubbleBorder: '#7cc7e8',
        glow: 'rgba(124, 199, 232, 0.35)',
        official: {
            title: {
                gradient: { from: '#a8c4e8', via: '#a0a9d8', to: '#9181c4' },
                bar: 'linear-gradient(to right, #a8c4e8, #9181c4)',
                text: '#5d95ae',
            },
            canvas: ['#c8d8ec', '#dde6f0', '#f0f4f8'],
            shelter: { picture: '#a8d0e8', video: '#c4a8d8', voice: '#b8a8d8', text: '#8bb8d6' },
            shelterStyle: 'classic',
            headerStyle: 'gradient',
        },
        legacyNeutral: { surfaceBackground: '#FEFEFE', textSecondary: '#4b5563', textMuted: '#9ca3af' },
    },
    sakurazaka: {
        logo: '#f19db5',
        scale: {
            50: '#fff3f6', 100: '#ffe5eb', 200: '#fecdda', 300: '#feacc3', 400: '#f19db5',
            500: '#e76692', 600: '#c84575', 700: '#a72f5d', 800: '#852048', 900: '#641434',
        },
        bubbleBorder: '#f19db5',
        glow: 'rgba(241, 157, 181, 0.35)',
        official: {
            title: {
                gradient: { from: '#fffdfe', via: '#d8b0c8', to: '#9b56a1' },
                bar: 'linear-gradient(to right, #ffffff 0%, #ffffff 5%, #fff6f7 10%, #eec8d2 25%, #e39eb1 50%, #bf78a0 75%, #95569c 100%)',
                text: '#d892aa',
            },
            canvas: ['#fce7f3', '#fdf2f8', '#fff5f7'],
            shelter: { picture: '#ec9595', video: '#edc094', voice: '#d695ec', text: '#eb95ae' },
            shelterStyle: 'light',
            headerStyle: 'light',
        },
        legacyNeutral: { surfaceBackground: '#FAFBFC', textSecondary: '#5a5a6e', textMuted: '#9898a8' },
    },
    nogizaka: {
        logo: '#7f1083',
        scale: {
            50: '#fef3fe', 100: '#fce4fc', 200: '#f9cbf8', 300: '#f1abf1', 400: '#e389e4',
            500: '#d06ad2', 600: '#b24ab5', 700: '#943397', 800: '#7f1083', 900: '#57175a',
        },
        bubbleBorder: '#b24ab5',
        glow: 'rgba(127, 16, 131, 0.28)',
        official: {
            title: {
                gradient: { from: '#d8c8e8', via: '#c4a8d8', to: '#9B59B6' },
                bar: 'linear-gradient(to right, #9B59B6, #7e1083)',
                text: '#7e1083',
            },
            canvas: ['#ede4f2', '#f3eef6', '#f8f5fa'],
            shelter: { picture: '#c4a8d8', video: '#9B59B6', voice: '#b8a8d8', text: '#d8c8e8' },
            shelterStyle: 'classic',
            headerStyle: 'gradient',
        },
        legacyNeutral: { surfaceBackground: '#FCFBFD', textSecondary: '#5c5666', textMuted: '#8e889a' },
    },
    yodel: {
        logo: '#5a8a6a',
        scale: {
            50: '#f3f8f4', 100: '#e5f0e8', 200: '#cde3d3', 300: '#afd1b9', 400: '#90bc9e',
            500: '#74a684', 600: '#5a8a6a', 700: '#416f51', 800: '#30573e', 900: '#21402c',
        },
        bubbleBorder: '#5a8a6a',
        glow: 'rgba(90, 138, 106, 0.3)',
        official: {
            title: {
                gradient: { from: '#b8d8c8', via: '#8ab89a', to: '#5a8a6a' },
                bar: 'linear-gradient(to right, #b8d8c8, #5a8a6a)',
                text: '#4a7a5a',
            },
            canvas: ['#d4ebe0', '#e5f2eb', '#f0f8f4'],
            shelter: { picture: '#8ab89a', video: '#6a9a7a', voice: '#7aaa8a', text: '#5a8a6a' },
            shelterStyle: 'classic',
            headerStyle: 'gradient',
        },
        legacyNeutral: { surfaceBackground: '#FBFDFC', textSecondary: '#4b5e53', textMuted: '#8fa399' },
    },
    default: {
        logo: '#6b7280',
        scale: {
            50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db', 400: '#9ca3af',
            500: '#6b7280', 600: '#4b5563', 700: '#374151', 800: '#1f2937', 900: '#111827',
        },
        bubbleBorder: '#E5E7EB',
        glow: 'rgba(107, 114, 128, 0.25)',
        official: {
            title: {
                gradient: { from: '#a8c4e8', via: '#a0a9d8', to: '#9181c4' },
                bar: 'linear-gradient(to right, #a8c4e8, #9181c4)',
                text: '#4B5563',
            },
            canvas: ['#e5e7eb', '#f3f4f6', '#f9fafb'],
            shelter: { picture: '#a8d0e8', video: '#c4a8d8', voice: '#b8a8d8', text: '#8bb8d6' },
            shelterStyle: 'classic',
            headerStyle: 'gradient',
        },
        legacyNeutral: { surfaceBackground: '#FAFAFA', textSecondary: '#4B5563', textMuted: '#9CA3AF' },
    },
};
