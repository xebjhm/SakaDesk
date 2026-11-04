/**
 * Per-group colour tokens — the ONLY place group colours are defined.
 *
 * Group colour may appear in four places only: title gradient, selection
 * ring/glow, bubble border and badge (plus at most one `primary` button per
 * screen, which uses `accent`). `canvas` is the level-0 background gradient.
 *
 * Values are copied verbatim from the pre-D1 `serviceThemes.ts`;
 * `legacy-theme-values.json` pins them.
 */
export type GroupId = 'hinatazaka' | 'sakurazaka' | 'nogizaka' | 'yodel' | 'default';

export const GROUP_IDS: readonly GroupId[] = ['hinatazaka', 'sakurazaka', 'nogizaka', 'yodel', 'default'];

export interface GroupTokens {
    /** Brand colour; also the one-per-screen primary button. */
    accent: string;
    /** Level-0 background gradient stops, top to bottom. */
    canvas: readonly [string, string, string];
    title: {
        /** Chat/blog title gradient. */
        gradient: { from: string; via: string; to: string };
        /** Thin gradient bar under the title. */
        bar: string;
        /** Title text colour on light headers. */
        text: string;
    };
    /** Keyboard focus ring. */
    ring: string;
    /** Selection glow around the white selection ring. */
    glow: string;
    /** Message bubble border. */
    bubbleBorder: string;
    /** Unread badge background. */
    badge: string;
}

export const groupTokens: Record<GroupId, GroupTokens> = {
    hinatazaka: {
        accent: '#7cc7e8',
        canvas: ['#c8d8ec', '#dde6f0', '#f0f4f8'],
        title: {
            gradient: { from: '#a8c4e8', via: '#a0a9d8', to: '#9181c4' },
            bar: 'linear-gradient(to right, #a8c4e8, #9181c4)',
            text: '#5d95ae',
        },
        ring: '#7cc7e8',
        glow: 'rgba(124, 199, 232, 0.35)',
        bubbleBorder: '#7cc7e8',
        badge: '#7cc7e8',
    },
    sakurazaka: {
        accent: '#f7a6c9',
        canvas: ['#fce7f3', '#fdf2f8', '#fff5f7'],
        title: {
            gradient: { from: '#fffdfe', via: '#d8b0c8', to: '#9b56a1' },
            bar: 'linear-gradient(to right, #ffffff 0%, #ffffff 5%, #fff6f7 10%, #eec8d2 25%, #e39eb1 50%, #bf78a0 75%, #95569c 100%)',
            text: '#d892aa',
        },
        ring: '#f7a6c9',
        glow: 'rgba(247, 166, 201, 0.35)',
        bubbleBorder: '#E85298',
        badge: '#E85298',
    },
    nogizaka: {
        accent: '#7e1083',
        canvas: ['#ede4f2', '#f3eef6', '#f8f5fa'],
        title: {
            gradient: { from: '#d8c8e8', via: '#c4a8d8', to: '#9B59B6' },
            bar: 'linear-gradient(to right, #9B59B6, #7e1083)',
            text: '#7e1083',
        },
        ring: '#9B59B6',
        glow: 'rgba(126, 16, 131, 0.28)',
        bubbleBorder: '#9B59B6',
        badge: '#9B59B6',
    },
    yodel: {
        accent: '#5a8a6a',
        canvas: ['#d4ebe0', '#e5f2eb', '#f0f8f4'],
        title: {
            gradient: { from: '#b8d8c8', via: '#8ab89a', to: '#5a8a6a' },
            bar: 'linear-gradient(to right, #b8d8c8, #5a8a6a)',
            text: '#4a7a5a',
        },
        ring: '#5a8a6a',
        glow: 'rgba(90, 138, 106, 0.3)',
        bubbleBorder: '#5a8a6a',
        badge: '#5a8a6a',
    },
    default: {
        accent: '#6B7280',
        canvas: ['#e5e7eb', '#f3f4f6', '#f9fafb'],
        title: {
            gradient: { from: '#a8c4e8', via: '#a0a9d8', to: '#9181c4' },
            bar: 'linear-gradient(to right, #a8c4e8, #9181c4)',
            text: '#4B5563',
        },
        ring: '#6B7280',
        glow: 'rgba(107, 114, 128, 0.25)',
        bubbleBorder: '#E5E7EB',
        badge: '#6B7280',
    },
};
