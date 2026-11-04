/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['"Noto Sans JP"', 'system-ui', '-apple-system', 'sans-serif'],
            },
            colors: {
                // Theme-aware colors (change when service switches)
                'theme-primary': 'var(--color-primary)',
                'theme-secondary': 'var(--color-secondary)',
                'theme-accent': 'var(--color-accent)',
                // Surfaces
                'surface-base': 'var(--color-surface-base)',
                'surface-elevated': 'var(--color-surface-elevated)',
                'surface-sunken': 'var(--color-surface-sunken)',
                // Text
                'text-primary': 'var(--color-text-primary)',
                'text-secondary': 'var(--color-text-secondary)',
                'text-muted': 'var(--color-text-muted)',
                'text-inverse': 'var(--color-text-inverse)',
                // Feedback
                'feedback-success': 'var(--color-success)',
                'feedback-warning': 'var(--color-warning)',
                'feedback-error': 'var(--color-error)',
                // Legacy (keep for backwards compatibility)
                'brand-purple-start': '#9181c4',
                'brand-purple-end': '#a8c4e8',
                'brand-blue': '#6da0d4',
            },
            backgroundImage: {
                // Theme-aware gradients
                'theme-gradient': 'linear-gradient(to right, var(--color-gradient-from), var(--color-gradient-to))',
                'theme-gradient-vertical': 'linear-gradient(to bottom, var(--color-gradient-from), var(--color-gradient-to))',
                // Design system (docs/design/DESIGN_SYSTEM.md)
                'group-canvas': 'var(--ds-group-canvas)',
                'group-title-bar': 'var(--ds-group-title-bar)',
            },
            // ---- Design system tokens (frontend/src/design/tokens) ----
            // Values are CSS variables written by design/applyTokens.ts.
            // Opacity modifiers (bg-sheet/50) do not work with these; add a token instead.
            backgroundColor: {
                sheet: 'var(--ds-surface-sheet)',
                card: 'var(--ds-surface-card)',
                pill: 'var(--ds-surface-pill)',
                elevated: 'var(--ds-surface-elevated)',
                sunken: 'var(--ds-surface-sunken)',
                scrim: 'var(--ds-overlay-scrim)',
                'group-accent': 'var(--ds-group-accent)',
                'group-badge': 'var(--ds-group-badge)',
                'group-subtle': 'var(--ds-group-subtle)',
            },
            textColor: {
                primary: 'var(--ds-text-primary)',
                secondary: 'var(--ds-text-secondary)',
                muted: 'var(--ds-text-muted)',
                inverse: 'var(--ds-text-inverse)',
                'group-title': 'var(--ds-group-title-text)',
                'group-strong': 'var(--ds-group-strong)',
            },
            borderColor: {
                subtle: 'var(--ds-border-subtle)',
                strong: 'var(--ds-border-strong)',
                'group-bubble': 'var(--ds-group-bubble-border)',
                'group-subtle': 'var(--ds-group-subtle-border)',
            },
            ringColor: {
                group: 'var(--ds-group-ring)',
            },
            textDecorationColor: {
                group: 'var(--ds-group-link-underline)',
            },
            borderRadius: {
                card: 'var(--ds-radius-card)',
                sheet: 'var(--ds-radius-sheet)',
                pill: 'var(--ds-radius-pill)',
            },
            boxShadow: {
                pill: 'var(--ds-shadow-pill)',
                card: 'var(--ds-shadow-card)',
                sheet: 'var(--ds-shadow-sheet)',
                'group-glow': 'var(--ds-shadow-group-glow)',
            },
            fontSize: {
                caption: ['var(--ds-font-caption-size)', { lineHeight: 'var(--ds-font-caption-leading)' }],
                small: ['var(--ds-font-small-size)', { lineHeight: 'var(--ds-font-small-leading)' }],
                body: ['var(--ds-font-body-size)', { lineHeight: 'var(--ds-font-body-leading)' }],
                title: ['var(--ds-font-title-size)', { lineHeight: 'var(--ds-font-title-leading)' }],
                heading: ['var(--ds-font-heading-size)', { lineHeight: 'var(--ds-font-heading-leading)' }],
            },
            keyframes: {
                landing: {
                    '0%': { backgroundColor: 'transparent' },
                    '15%': { backgroundColor: 'var(--ds-group-highlight)' },
                    '40%': { backgroundColor: 'var(--ds-group-highlight)' },
                    '100%': { backgroundColor: 'transparent' },
                },
            },
            animation: {
                landing: 'landing var(--ds-duration-landing) var(--ds-ease-standard) both',
            },
            transitionDuration: {
                fast: 'var(--ds-duration-fast)',
                base: 'var(--ds-duration-base)',
                glide: 'var(--ds-duration-glide)',
            },
            transitionTimingFunction: {
                standard: 'var(--ds-ease-standard)',
            },
        },
    },
    plugins: [],
}
