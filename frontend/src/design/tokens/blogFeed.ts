/**
 * The blog feed's original look (commit e4e4118), restored after the user rejected the
 * D2b replacements: the photo tile with its floating caption card. The values are
 * e4e4118's, verbatim; accent-coloured layers mix the accent roles in
 * `cssVars.ts` / `tailwind.config.js` and use only the neutral parts below.
 */
export const blogFeed = {
    /** Caption text sizes on a feed tile (normal / featured `Lg`): e4e4118 rem values. */
    type: {
        tileDate: '0.5rem',
        tileDateLg: '0.6rem',
        tileTitle: '0.75rem',
        tileTitleLg: '0.9rem',
        tileName: '0.6rem',
        tileNameLg: '0.7rem',
    },
    shadow: {
        /** The photo tile at rest. */
        tile: '0 6px 24px -6px rgba(0, 0, 0, 0.12)',
        /** The neutral layer under the tile's hover glow. */
        tileLift: '0 8px 24px -8px rgba(0, 0, 0, 0.18)',
        /** The caption card at rest. */
        caption: '0 6px 20px -6px rgba(0, 0, 0, 0.1)',
        /** The neutral layer under the caption card's hover glow. */
        captionLift: '0 6px 16px -4px rgba(0, 0, 0, 0.1)',
    },
    /** The caption card's frosted white and its hairline. */
    glass: 'rgba(255, 255, 255, 0.92)',
    glassBorder: 'rgba(255, 255, 255, 0.6)',
    /** The soft dark fade along the tile's bottom edge. */
    vignette: 'rgba(0, 0, 0, 0.05)',
    /** The feed header's All / Favorite segmented control: grey track, raised white selected segment. */
    segment: {
        track: 'rgba(0, 0, 0, 0.05)',
        shadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
        size: '0.75rem',
    },
    /** The timeline rail lens: where its glow centres before the zoom sets it (a CSS position). */
    railLensY: '50%',
    motion: {
        /**
         * Milliseconds: the tile lift and its glow (`lift`), the photo zoom and fade-in (`zoom`),
         * and the timeline rail's fisheye zoom (`lens`: track width, lens glow, markers and dot).
         */
        duration: { lift: 500, zoom: 700, lens: 300 },
        /** The caption card's springy hover nudge. */
        spring: [0.34, 1.56, 0.64, 1],
    },
} as const;
