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
                reading: 'var(--ds-font-family-reading)',
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
                'group-title': 'linear-gradient(to right, var(--ds-group-title-from), var(--ds-group-title-via), var(--ds-group-title-to))',
                'group-title-bar': 'var(--ds-group-title-bar)',
                'group-ambient-1': 'var(--ds-group-ambient-1)',
                'group-ambient-2': 'var(--ds-group-ambient-2)',
                'group-ambient-3': 'var(--ds-group-ambient-3)',
                // Member penlight wash (data-driven, docs/design/DESIGN_SYSTEM.md): two corner glows.
                'member-wash':
                    'radial-gradient(ellipse 80% 50% at 0% 0%, color-mix(in srgb, var(--ds-member-wash-1) var(--ds-member-wash-alpha), transparent) 0%, transparent 50%), ' +
                    'radial-gradient(ellipse 60% 40% at 100% 100%, color-mix(in srgb, var(--ds-member-wash-2) var(--ds-member-wash-alpha), transparent) 0%, transparent 50%)',
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
                'mark-exact': 'var(--ds-mark-exact)',
                'mark-reading': 'var(--ds-mark-reading)',
                toast: 'var(--ds-overlay-toast)',
                'status-danger': 'var(--ds-status-danger)',
                'status-attention': 'var(--ds-status-attention)',
                'viewer-scrim': 'var(--ds-viewer-scrim)',
                'viewer-stage': 'var(--ds-viewer-stage)',
                'viewer-control': 'var(--ds-viewer-control)',
                'viewer-control-hover': 'var(--ds-viewer-control-hover)',
                'control-off': 'var(--ds-border-strong)',
                'group-marker': 'var(--ds-group-marker)',
            },
            textColor: {
                primary: 'var(--ds-text-primary)',
                secondary: 'var(--ds-text-secondary)',
                muted: 'var(--ds-text-muted)',
                inverse: 'var(--ds-text-inverse)',
                'group-title': 'var(--ds-group-title-text)',
                'group-strong': 'var(--ds-group-strong)',
                'status-danger': 'var(--ds-status-danger)',
                'status-success': 'var(--ds-status-success)',
                'status-warning': 'var(--ds-status-warning)',
                viewer: 'var(--ds-viewer-text)',
                'viewer-muted': 'var(--ds-viewer-text-muted)',
                sunday: 'var(--ds-decor-sunday)',
                heart: 'var(--ds-decor-heart)',
            },
            borderColor: {
                subtle: 'var(--ds-border-subtle)',
                strong: 'var(--ds-border-strong)',
                'mark-underline': 'var(--ds-mark-underline)',
                'group-bubble': 'var(--ds-group-bubble-border)',
                'group-subtle': 'var(--ds-group-subtle-border)',
                surface: 'var(--ds-surface-sheet)',
            },
            ringColor: {
                group: 'var(--ds-group-ring)',
                'group-logo': 'var(--ds-group-logo)',
                surface: 'var(--ds-surface-sheet)',
            },
            ringOffsetColor: {
                surface: 'var(--ds-surface-sheet)',
            },
            textDecorationColor: {
                group: 'var(--ds-group-link-underline)',
                viewer: 'var(--ds-viewer-underline)',
            },
            accentColor: {
                group: 'var(--ds-group-accent)',
            },
            borderRadius: {
                tail: 'var(--ds-radius-tail)',
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
                reading: ['var(--ds-font-reading-size)', { lineHeight: 'var(--ds-font-reading-leading)' }],
            },
            keyframes: {
                landing: {
                    '0%': { backgroundColor: 'transparent' },
                    '15%': { backgroundColor: 'var(--ds-group-highlight)' },
                    '40%': { backgroundColor: 'var(--ds-group-highlight)' },
                    '100%': { backgroundColor: 'transparent' },
                },
                reveal: {
                    '0%': { opacity: '0', transform: 'translateY(8px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                'orb-drift-1': {
                    '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
                    '20%': { transform: 'translate(25px, 15px) scale(1.02)' },
                    '40%': { transform: 'translate(-10px, 35px) scale(0.98)' },
                    '60%': { transform: 'translate(35px, -10px) scale(1.03)' },
                    '80%': { transform: 'translate(-15px, 20px) scale(0.99)' },
                },
                'orb-drift-2': {
                    '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
                    '25%': { transform: 'translate(-30px, 20px) scale(1.04)' },
                    '50%': { transform: 'translate(20px, -25px) scale(0.97)' },
                    '75%': { transform: 'translate(-15px, -15px) scale(1.02)' },
                },
                'orb-breathe': {
                    '0%, 100%': { transform: 'scale(1) translate(0, 0)', opacity: 'var(--orb-opacity, 0.35)' },
                    '33%': { transform: 'scale(1.08) translate(20px, -15px)', opacity: 'calc(var(--orb-opacity, 0.35) * 1.15)' },
                    '66%': { transform: 'scale(0.95) translate(-15px, 10px)', opacity: 'calc(var(--orb-opacity, 0.35) * 0.9)' },
                },
                'heart-float': {
                    '0%': { opacity: '1', transform: 'translateX(-50%) translateY(0) scale(1)' },
                    '100%': { opacity: '0', transform: 'translateX(-50%) translateY(-30px) scale(1.3)' },
                },
                heartbeat: {
                    '0%, 100%': { transform: 'scale(1)' },
                    '15%': { transform: 'scale(1.3)' },
                    '30%': { transform: 'scale(1)' },
                    '45%': { transform: 'scale(1.2)' },
                    '60%': { transform: 'scale(1)' },
                },
            },
            animation: {
                landing: 'landing var(--ds-duration-landing) var(--ds-ease-standard) both',
                reveal: 'reveal var(--ds-duration-base) var(--ds-ease-standard) backwards',
                'orb-drift-1': 'orb-drift-1 28s ease-in-out infinite',
                'orb-drift-2': 'orb-drift-2 34s ease-in-out infinite',
                'orb-breathe': 'orb-breathe 22s ease-in-out infinite',
                'heart-float': 'heart-float 800ms ease-out forwards',
                heartbeat: 'heartbeat 1.2s ease-in-out infinite',
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
