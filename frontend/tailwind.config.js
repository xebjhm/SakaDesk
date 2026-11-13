/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            maxHeight: {
                // Three text-small lines: the fallback cap of a line-clamp-3 block (the 特別な日 postcard front).
                'small-3': 'calc(var(--ds-font-small-leading) * 3)',
            },
            brightness: { 94: '.94', 106: '1.06' },
            backdropBlur: { frost: '20px' },
            // The media tile's blur preview (a 16 px image blown up to the tile; DESIGN_SYSTEM "Media tile").
            blur: { placeholder: '12px' },
            backdropSaturate: { 180: '1.8' },
            fontFamily: {
                sans: 'var(--ds-font-family-sans)',
                display: 'var(--ds-font-family-serif)',
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
                'accent-gradient': 'var(--ds-accent-gradient)',
                'accent-wash': 'var(--ds-accent-wash)',
                'accent-tonal': 'var(--ds-accent-tonal)',
                'expressive-soft': 'var(--ds-expressive-soft)',
                'expressive-header': 'var(--ds-expressive-header)',
                'expressive-header-bar': 'var(--ds-expressive-header-bar)',
                'expressive-progress': 'var(--ds-expressive-progress)',
                'expressive-orb-1': 'var(--ds-expressive-orb-1)',
                'expressive-orb-2': 'var(--ds-expressive-orb-2)',
                'expressive-orb-3': 'var(--ds-expressive-orb-3)',
                aurora: 'var(--ds-aurora)',
                // Blog feed tile (e4e4118 look): the hover aura (logo 19 % -> accent 8 %), the photo
                // placeholder (logo 9 % -> accent 7 %, 145deg) and the bottom-edge vignette.
                'accent-aura': 'radial-gradient(ellipse at center, color-mix(in srgb, var(--ds-accent-logo) 19%, transparent) 0%, color-mix(in srgb, var(--ds-accent) 8%, transparent) 50%, transparent 70%)',
                'accent-tile': 'linear-gradient(145deg, color-mix(in srgb, var(--ds-accent-logo) 9%, transparent) 0%, color-mix(in srgb, var(--ds-accent) 7%, transparent) 100%)',
                'tile-vignette': 'linear-gradient(to top, var(--ds-blog-vignette) 0%, transparent 20%)',
                // Timeline rail lens (e4e4118 "light through a lens"): a strong-colour glow at 8 % ("15" hex
                // alpha) centred on the zoom; TimelineRail sets --ds-rail-lens-y.
                // Memories keepsake surfaces (tokens/memories.ts): the cork board and the special-card foil.
                'memories-cork': 'var(--ds-mem-cork)',
                'memories-foil': 'var(--ds-mem-foil)',
                // The ruled lines of a 特別な日 postcard's back (20 px, the text-small line height).
                'memories-ruled': 'var(--ds-mem-ruled)',
                // Memories fun wave (semantic): the SR rarity sheen, the radio night and the 24h sky.
                'memories-rarity-sr': 'var(--ds-mem-rarity-sr)',
                'memories-night': 'var(--ds-mem-night)',
                'memories-sky': 'var(--ds-mem-sky)',
                'accent-lens': 'radial-gradient(ellipse 100% 30% at 50% var(--ds-rail-lens-y), color-mix(in srgb, var(--ds-accent-strong) 8%, transparent) 0%, transparent 70%)',
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
                accent: 'var(--ds-accent)',
                'accent-strong': 'var(--ds-accent-strong)',
                'accent-subtle': 'var(--ds-accent-subtle)',
                'accent-border': 'var(--ds-accent-border)',
                'accent-logo': 'var(--ds-accent-logo)',
                sheet: 'var(--ds-surface-sheet)',
                card: 'var(--ds-surface-card)',
                pill: 'var(--ds-surface-pill)',
                elevated: 'var(--ds-surface-elevated)',
                sunken: 'var(--ds-surface-sunken)',
                window: 'var(--ds-surface-window)',
                scrim: 'var(--ds-overlay-scrim)',
                'group-accent': 'var(--ds-group-accent)',
                'group-badge': 'var(--ds-group-badge)',
                'group-subtle': 'var(--ds-group-subtle)',
                'mark-exact': 'var(--ds-mark-exact)',
                'mark-reading': 'var(--ds-mark-reading)',
                toast: 'var(--ds-overlay-toast)',
                'status-danger': 'var(--ds-semantic-danger-solid)',
                'status-success': 'var(--ds-semantic-success-solid)',
                'status-attention': 'var(--ds-semantic-warning-solid)',
                'semantic-success-subtle': 'var(--ds-semantic-success-subtle)',
                'semantic-warning-subtle': 'var(--ds-semantic-warning-subtle)',
                'semantic-danger-subtle': 'var(--ds-semantic-danger-subtle)',
                'semantic-info-subtle': 'var(--ds-semantic-info-subtle)',
                'semantic-success-icon': 'var(--ds-semantic-success-icon)',
                'semantic-warning-icon': 'var(--ds-semantic-warning-icon)',
                'semantic-danger-icon': 'var(--ds-semantic-danger-icon)',
                'semantic-info-icon': 'var(--ds-semantic-info-icon)',
                'semantic-oshi-subtle': 'var(--ds-semantic-oshi-subtle)',
                'semantic-oshi-solid': 'var(--ds-semantic-oshi-solid)',
                'viewer-scrim': 'var(--ds-viewer-scrim)',
                'viewer-stage': 'var(--ds-viewer-stage)',
                'viewer-control': 'var(--ds-viewer-control)',
                'viewer-control-hover': 'var(--ds-viewer-control-hover)',
                console: 'var(--ds-console-bg)',
                'console-badge': 'var(--ds-console-badge)',
                'control-off': 'var(--ds-border-strong)',
                // Loading skeleton base (Favourites video placeholder).
                skeleton: 'var(--ds-border-strong)',
                // The default Skeleton tone: a translucent ink veil, visible on any light surface.
                'skeleton-veil': 'var(--ds-overlay-skeleton)',
                'group-marker': 'var(--ds-group-marker)',
                // Chat header pills (pre-D2 look): glass / shade on the title gradient, title-text tints on a light header.
                'header-glass': 'var(--ds-overlay-glass)',
                'header-shade': 'var(--ds-overlay-shade)',
                'frost': 'var(--ds-overlay-frost)',
                'group-title-tint': 'color-mix(in srgb, var(--ds-group-title-text) 12.5%, transparent)',
                'group-title-wash': 'color-mix(in srgb, var(--ds-group-title-text) 8%, transparent)',
                // Official unread shelters.
                'group-shelter-picture': 'var(--ds-group-shelter-picture)',
                'group-shelter-video': 'var(--ds-group-shelter-video)',
                'group-shelter-voice': 'var(--ds-group-shelter-voice)',
                'group-shelter-text': 'var(--ds-group-shelter-text)',
                // Blog feed tile caption card (e4e4118 frosted white).
                'tile-glass': 'var(--ds-blog-glass)',
                // The feed's All / Favorite segmented control track (e4e4118 black at 5 %).
                'segment-track': 'var(--ds-blog-segment-track)',
                // Memories keepsake surfaces: letter / polaroid paper and translucent washi tape.
                'memories-paper': 'var(--ds-mem-paper)',
                'memories-washi': 'var(--ds-mem-washi)',
                // Memories fun wave (semantic): N / R rarity, the on-air lamp and the capsule note.
                'memories-rarity-n': 'var(--ds-mem-rarity-n)',
                'memories-rarity-r': 'var(--ds-mem-rarity-r)',
                'memories-onair': 'var(--ds-mem-onair)',
                'memories-note': 'var(--ds-mem-note)',
            },
            textColor: {
                // Memories fun wave (semantic): ink on the radio night (the on-air lamp is non-text only).
                'memories-night-ink': 'var(--ds-mem-night-ink)',
                accent: 'var(--ds-accent)',
                'accent-strong': 'var(--ds-accent-strong)',
                'accent-tonal': 'var(--ds-accent-tonal-text)',
                'expressive-header': 'var(--ds-expressive-header-text)',
                primary: 'var(--ds-text-primary)',
                secondary: 'var(--ds-text-secondary)',
                muted: 'var(--ds-text-muted)',
                inverse: 'var(--ds-text-inverse)',
                'group-title': 'var(--ds-group-title-text)',
                'group-strong': 'var(--ds-group-strong)',
                'status-danger': 'var(--ds-semantic-danger-text)',
                'status-success': 'var(--ds-semantic-success-text)',
                'status-warning': 'var(--ds-semantic-warning-text)',
                'semantic-success': 'var(--ds-semantic-success-text)',
                'semantic-warning': 'var(--ds-semantic-warning-text)',
                'semantic-danger': 'var(--ds-semantic-danger-text)',
                'semantic-info': 'var(--ds-semantic-info-text)',
                'semantic-oshi': 'var(--ds-semantic-oshi-text)',
                'semantic-oshi-solid': 'var(--ds-semantic-oshi-solid)',
                'semantic-star': 'var(--ds-semantic-star)',
                viewer: 'var(--ds-viewer-text)',
                'viewer-muted': 'var(--ds-viewer-text-muted)',
                console: 'var(--ds-console-text)',
                'console-muted': 'var(--ds-console-text-muted)',
                'console-prompt': 'var(--ds-console-prompt)',
                'console-error': 'var(--ds-console-error)',
                'console-warning': 'var(--ds-console-warning)',
                'console-badge': 'var(--ds-console-badge-text)',
                'calendar-holiday': 'var(--ds-calendar-holiday)',
                'calendar-saturday': 'var(--ds-calendar-saturday)',
                heart: 'var(--ds-decor-heart)',
                'group-shelter-picture': 'var(--ds-group-shelter-picture)',
                'group-shelter-video': 'var(--ds-group-shelter-video)',
                'group-shelter-voice': 'var(--ds-group-shelter-voice)',
                'group-shelter-text': 'var(--ds-group-shelter-text)',
            },
            borderColor: {
                'accent-border': 'var(--ds-accent-border)',
                'accent-wash': 'var(--ds-accent-wash-border)',
                accent: 'var(--ds-accent)',
                'accent-strong': 'var(--ds-accent-strong)',
                'frost': 'var(--ds-overlay-frost-border)',
                subtle: 'var(--ds-border-subtle)',
                strong: 'var(--ds-border-strong)',
                'mark-underline': 'var(--ds-mark-underline)',
                'semantic-success': 'var(--ds-semantic-success-border)',
                'semantic-warning': 'var(--ds-semantic-warning-border)',
                'semantic-danger': 'var(--ds-semantic-danger-border)',
                'semantic-info': 'var(--ds-semantic-info-border)',
                'semantic-oshi': 'var(--ds-semantic-oshi-border)',
                'group-bubble': 'var(--ds-group-bubble-border)',
                'group-subtle': 'var(--ds-group-subtle-border)',
                surface: 'var(--ds-surface-sheet)',
                'tile-glass': 'var(--ds-blog-glass-border)',
                // Memories: the paper's hairline and an unearned card's dashed silhouette.
                'memories-paper': 'var(--ds-mem-paper-line)',
                'memories-silhouette': 'var(--ds-mem-silhouette)',
                'group-shelter-picture': 'var(--ds-group-shelter-picture)',
                'group-shelter-video': 'var(--ds-group-shelter-video)',
                'group-shelter-voice': 'var(--ds-group-shelter-voice)',
                'group-shelter-text': 'var(--ds-group-shelter-text)',
            },
            ringColor: {
                accent: 'var(--ds-accent)',
                'expressive-header': 'var(--ds-expressive-header-text)',
                // Header-button focus ring: header text on a gradient header, the strong step on a light one.
                'expressive-header-focus': 'var(--ds-expressive-header-focus)',
                'accent-border': 'var(--ds-accent-border)',
                'accent-logo': 'var(--ds-accent-logo)',
                'accent-subtle': 'var(--ds-accent-subtle)',
                'semantic-oshi': 'var(--ds-semantic-oshi-border)',
                group: 'var(--ds-group-ring)',
                'group-logo': 'var(--ds-group-logo)',
                surface: 'var(--ds-surface-sheet)',
                strong: 'var(--ds-border-strong)',
            },
            fill: {
                'semantic-oshi': 'var(--ds-semantic-oshi-solid)',
            },
            ringOffsetColor: {
                surface: 'var(--ds-surface-sheet)',
            },
            textDecorationColor: {
                group: 'var(--ds-group-link-underline)',
                viewer: 'var(--ds-viewer-underline)',
            },
            accentColor: {
                accent: 'var(--ds-accent)',
                group: 'var(--ds-group-accent)',
            },
            borderRadius: {
                none: 'var(--ds-radius-none)',
                xs: 'var(--ds-radius-xs)',
                sm: 'var(--ds-radius-sm)',
                md: 'var(--ds-radius-md)',
                lg: 'var(--ds-radius-lg)',
                xl: 'var(--ds-radius-xl)',
                full: 'var(--ds-radius-full)',
                tail: 'var(--ds-radius-tail)',
                card: 'var(--ds-radius-card)',
                sheet: 'var(--ds-radius-sheet)',
                pill: 'var(--ds-radius-pill)',
            },
            boxShadow: {
                'accent-glow': 'var(--ds-shadow-accent-glow)',
                'accent-halo': 'var(--ds-shadow-accent-halo)',
                'accent-glow-hover': 'var(--ds-shadow-accent-glow-hover)',
                'accent-unread': 'var(--ds-shadow-accent-unread)',
                'accent-beacon': 'var(--ds-shadow-accent-beacon)',
                pill: 'var(--ds-shadow-pill)',
                card: 'var(--ds-shadow-card)',
                sheet: 'var(--ds-shadow-sheet)',
                'group-glow': 'var(--ds-shadow-group-glow)',
                // Blog feed tile (e4e4118 look).
                tile: 'var(--ds-blog-shadow-tile)',
                'tile-hover': 'var(--ds-shadow-accent-tile)',
                caption: 'var(--ds-blog-shadow-caption)',
                'caption-hover': 'var(--ds-shadow-accent-caption)',
                segment: 'var(--ds-blog-shadow-segment)',
                // Memories: a polaroid lying on a surface.
                'memories-polaroid': 'var(--ds-mem-shadow-polaroid)',
            },
            fontSize: {
                caption: ['var(--ds-font-caption-size)', { lineHeight: 'var(--ds-font-caption-leading)' }],
                small: ['var(--ds-font-small-size)', { lineHeight: 'var(--ds-font-small-leading)' }],
                body: ['var(--ds-font-body-size)', { lineHeight: 'var(--ds-font-body-leading)' }],
                title: ['var(--ds-font-title-size)', { lineHeight: 'var(--ds-font-title-leading)' }],
                heading: ['var(--ds-font-heading-size)', { lineHeight: 'var(--ds-font-heading-leading)' }],
                display: ['var(--ds-font-display-size)', { lineHeight: 'var(--ds-font-display-leading)' }],
                reading: ['var(--ds-font-reading-size)', { lineHeight: 'var(--ds-font-reading-leading)' }],
                // Blog feed tile caption (e4e4118 sizes; size only, the line height is inherited).
                'tile-date': 'var(--ds-blog-font-tile-date)',
                'tile-date-lg': 'var(--ds-blog-font-tile-date-lg)',
                'tile-title': 'var(--ds-blog-font-tile-title)',
                'tile-title-lg': 'var(--ds-blog-font-tile-title-lg)',
                'tile-name': 'var(--ds-blog-font-tile-name)',
                'tile-name-lg': 'var(--ds-blog-font-tile-name-lg)',
                segment: 'var(--ds-blog-font-segment)',
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
                shimmer: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } },
                'shimmer-sweep': { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(200%)' } },
                // Indeterminate ProgressBar: a 1/3-wide segment sweeps across the track (design/primitives/ProgressBar.tsx).
                'progress-indeterminate': { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(300%)' } },
                pop: { '0%': { opacity: '0', transform: 'scale(0.9)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
                burst: {
                    '0%': { opacity: '1', transform: 'translate(0, 0) rotate(0deg)' },
                    '100%': { opacity: '0', transform: 'translate(var(--dx), var(--dy)) rotate(540deg)' },
                },
                'sparkle-burst': {
                    '0%': { opacity: '0', transform: 'translate(0, 0) rotate(0deg)' },
                    '10%': { opacity: '1' },
                    '100%': { opacity: '0', transform: 'translate(var(--dx), var(--dy)) rotate(540deg)' },
                },
                // Recap star clock: a star drops into place (the end state is the element's own).
                'star-fall': { '0%': { opacity: '0', transform: 'translateY(-14px)' } },
                // Recap burst: a photo fans out from the stack (the end state is the element's own transform).
                'fan-in': { '0%': { opacity: '0', transform: 'translateY(12px) rotate(0deg) scale(0.92)' } },
                // Recap petals: a petal drifts down into place (the end state is the element's own transform).
                'petal-fall': { '0%': { opacity: '0', transform: 'translateY(-160px) rotate(-40deg)' } },
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
                'toast-in': 'reveal var(--ds-duration-toast) var(--ds-ease-standard) backwards',
                'orb-drift-1': 'orb-drift-1 28s ease-in-out infinite',
                'orb-drift-2': 'orb-drift-2 34s ease-in-out infinite',
                'orb-breathe': 'orb-breathe 22s ease-in-out infinite',
                'heart-float': 'heart-float 800ms ease-out forwards',
                heartbeat: 'heartbeat 1.2s ease-in-out infinite',
                'star-fall': 'star-fall 600ms var(--ds-ease-standard) both',
                'fan-in': 'fan-in 500ms var(--ds-ease-standard) both',
                'petal-fall': 'petal-fall 1600ms var(--ds-ease-standard) both',
                shimmer: 'shimmer 1.2s 300ms var(--ds-ease-standard) both',
                'shimmer-sweep': 'shimmer-sweep 1.4s var(--ds-ease-standard) infinite',
                'progress-indeterminate': 'progress-indeterminate 1.4s var(--ds-ease-standard) infinite',
                pop: 'pop 500ms cubic-bezier(0.2, 1.4, 0.4, 1) both',
                confetti: 'burst 1.2s cubic-bezier(0.2, 0.7, 0.3, 1) both',
                sparkle: 'sparkle-burst 900ms 350ms cubic-bezier(0.2, 0.7, 0.3, 1) both',
            },
            scale: {
                97: '0.97',
            },
            // Memories: a photo aged by its year (shared/sepia.ts): 1 = last year, 2, 3 = three or more.
            sepia: {
                'memories-1': 'var(--ds-mem-sepia-1)',
                'memories-2': 'var(--ds-mem-sepia-2)',
                'memories-3': 'var(--ds-mem-sepia-3)',
            },
            transitionDuration: {
                fast: 'var(--ds-duration-fast)',
                base: 'var(--ds-duration-base)',
                glide: 'var(--ds-duration-glide)',
                lift: 'var(--ds-duration-lift)',
                zoom: 'var(--ds-duration-zoom)',
                lens: 'var(--ds-duration-lens)',
            },
            transitionTimingFunction: {
                standard: 'var(--ds-ease-standard)',
                spring: 'var(--ds-ease-spring)',
            },
        },
    },
    plugins: [
        // Vertical edge fade for a decorative layer (Atmosphere `fade`, docs/design/DESIGN_SYSTEM.md):
        // transparent at the top and bottom edges, opaque through the middle. Alpha only, no colour.
        ({ addUtilities }) => {
            const fadeY = 'linear-gradient(to bottom, transparent 0%, black 20%, black 65%, transparent 100%)';
            addUtilities({ '.mask-fade-y': { maskImage: fadeY, WebkitMaskImage: fadeY } });
        },
        // The blog feed caption card's hover (e4e4118: "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1),
        // box-shadow 0.4s ease"): only the nudge springs; the glow eases, so it never overshoots.
        ({ addUtilities }) => {
            addUtilities({
                '.transition-caption': {
                    transitionProperty: 'transform, box-shadow',
                    transitionDuration: 'var(--ds-duration-glide)',
                    transitionTimingFunction: 'var(--ds-ease-spring), ease',
                },
            });
        },
        // The recap opening's star grid (recap/slides/OpeningSlides.tsx, docs/design/DESIGN_SYSTEM.md):
        // a size container of --star-cols x --star-rows equal cells (capped at 5.5rem a row), whose star
        // and caption sizes (--star-size, --star-label) are container units set by the slide, so every
        // member fits the stage at any roster size.
        ({ addUtilities }) => {
            addUtilities({
                '.recap-star-grid': {
                    containerType: 'size',
                    gridTemplateColumns: 'repeat(var(--star-cols), minmax(0, 1fr))',
                    gridTemplateRows: 'repeat(var(--star-rows), minmax(0, 1fr))',
                    maxHeight: 'calc(var(--star-rows) * 5.5rem)',
                },
                '.recap-star-size': { width: 'var(--star-size)', height: 'var(--star-size)' },
                '.recap-star-label': { fontSize: 'var(--star-label)', lineHeight: '1.2' },
                // An inline icon one text-height tall (follows the surrounding font size).
                '.size-em': { width: '1em', height: '1em' },
            });
        },
        // Safe centring for scrollers (UI health C-L1): centred while the content fits, start-aligned
        // when it overflows, so its first part is never pushed out of reach. And a stable gutter for
        // a scroller whose content changes height under the user (Settings' tabs, C-L5).
        ({ addUtilities }) => {
            addUtilities({
                '.justify-safe-center': { justifyContent: 'safe center' },
                '.items-safe-center': { alignItems: 'safe center' },
                '.scrollbar-stable': { scrollbarGutter: 'stable' },
                // Japanese titles break between phrases, not mid-word (Chromium's auto-phrase, UI health C-Y5).
                '.phrase-break': { wordBreak: 'auto-phrase' },
            });
        },
    ],
}
