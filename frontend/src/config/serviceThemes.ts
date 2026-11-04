// frontend/src/config/serviceThemes.ts
// Service Theme Engine - Visual identity for each service

import { groupTokens, type GroupId } from '../design/tokens/groups';

export type { GroupId };

export interface ServiceTheme {
    id: GroupId;
    name: string;
    nameJp: string;

    // Core brand colors (single source of truth)
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;

    // Ambient background orbs
    ambient: {
        orb1: { color: string; position: string; size: string; opacity: number };
        orb2: { color: string; position: string; size: string; opacity: number };
        orb3: { color: string; position: string; size: string; opacity: number };
    };

    // UI surface colors
    surface: {
        background: string;
        card: string;
        glass: string;
        glassBorder: string;
    };

    // Typography colors
    text: {
        primary: string;
        secondary: string;
        muted: string;
    };

    // Interaction states
    interaction: {
        hoverGlow: string;
        focusRing: string;
        buttonGradient: string;
    };

    // Visual vibe keywords
    vibe: string[];

    // Blog feature colors
    blog: {
        memberNameColor: string;      // Member name in cards/headers
        linkColor: string;            // Links in blog content
        linkUnderlineColor: string;   // Subtle underline (40% opacity)
        headerTitleColor: string;     // "Latest Blogs" header
        timelineIndicator: string;    // Timeline dot/line color
    };

    // Modal accent colors (Date Search, Favorites, Media, Background, Sent Letters)
    modals: {
        accentColor: string;        // Primary accent for buttons, selected states
        accentColorLight: string;   // Lighter shade for backgrounds, hover states
        accentColorMuted: string;   // Muted for borders, subtle elements
    };

    // Messages feature colors
    messages: {
        headerGradient: {
            from: string;
            via: string;
            to: string;
        };
        headerTextColor: string;      // Header member name color
        headerBarGradient: string;    // Thin gradient bar below header
        bubbleBorder: string;         // Message bubble border color
        voicePlayerAccent: string;    // Voice player button/progress color
        scrollButtonColor: string;    // Scroll-to-bottom button color
        unreadShadow: string;         // Shadow glow for unread messages
        defaultBackground: string;    // Chat area background
        unreadBadge: string;         // Unread count badge
        sidebarGradient: string[];   // Sidebar selected item gradient
        // Per-service shelter overlay colors (unread message covers)
        shelterColors: {
            picture: string;
            video: string;
            voice: string;
            text: string;
        };
        // Shelter style: 'classic' = colored bg + white icon, 'light' = white bg + colored icon
        shelterStyle: 'classic' | 'light';
        // Header style: 'gradient' = filled gradient background with white text, 'light' = white/light bg with colored text
        headerStyle: 'gradient' | 'light';
    };
}

export const serviceThemes: Record<GroupId, ServiceTheme> = {
    // ========================================
    // HINATAZAKA46 - "The Sky" Theme
    // Airy, Happy, Sunlight through trees (Komorebi)
    // ========================================
    hinatazaka: {
        id: 'hinatazaka',
        name: 'Hinatazaka46',
        nameJp: '日向坂46',

        primaryColor: groupTokens.hinatazaka.accent,      // Sorairo (Sky Blue)
        secondaryColor: '#5dc2b5',    // Teal accent
        accentColor: '#fffacd',       // Soft sunlight yellow

        ambient: {
            orb1: {
                color: 'radial-gradient(circle, #c5ebfc 0%, #d9f3ff 30%, transparent 70%)',
                position: 'top: -20%; left: -10%;',
                size: '70vw',
                opacity: 0.4,
            },
            orb2: {
                color: 'radial-gradient(circle, #fff8dc 0%, #fffaeb 40%, transparent 70%)',
                position: 'top: 15%; right: -15%;',
                size: '60vw',
                opacity: 0.35,
            },
            orb3: {
                color: 'radial-gradient(circle, #d4f5ef 0%, transparent 70%)',
                position: 'bottom: -25%; left: 25%;',
                size: '50vw',
                opacity: 0.3,
            },
        },

        surface: {
            background: '#FEFEFE',
            card: 'rgba(255, 255, 255, 0.92)',
            glass: 'rgba(255, 255, 255, 0.78)',
            glassBorder: 'rgba(124, 199, 232, 0.2)',
        },

        text: {
            primary: '#1a1a2e',
            secondary: '#4b5563',
            muted: '#9ca3af',
        },

        interaction: {
            hoverGlow: groupTokens.hinatazaka.glow,
            focusRing: groupTokens.hinatazaka.ring,
            buttonGradient: 'linear-gradient(135deg, #7cc7e8 0%, #5dc2b5 100%)',
        },

        vibe: ['airy', 'bright', 'komorebi', 'summer sky', 'gentle warmth'],

        blog: {
            memberNameColor: '#5d95ae',
            linkColor: '#5d95ae',
            linkUnderlineColor: '#5d95ae40',
            headerTitleColor: '#5d95ae',
            timelineIndicator: '#5d95ae',
        },

        modals: {
            accentColor: '#7cc7e8',       // Sky blue - primary accent
            accentColorLight: '#e0f4fc',  // Light sky blue for backgrounds
            accentColorMuted: '#b8dff2',  // Muted for borders
        },

        messages: {
            headerGradient: { ...groupTokens.hinatazaka.title.gradient },
            headerTextColor: groupTokens.hinatazaka.title.text,
            headerBarGradient: groupTokens.hinatazaka.title.bar,
            bubbleBorder: groupTokens.hinatazaka.bubbleBorder,
            voicePlayerAccent: '#6da0d4',
            scrollButtonColor: '#7cc7e8',
            unreadShadow: '0 0 12px rgba(124, 199, 232, 0.4)',
            defaultBackground: '#E2E6EB',
            unreadBadge: groupTokens.hinatazaka.badge,
            sidebarGradient: [...groupTokens.hinatazaka.canvas],
            shelterColors: {
                picture: '#a8d0e8',   // Sky blue
                video: '#c4a8d8',     // Lavender/purple
                voice: '#b8a8d8',     // Light purple
                text: '#8bb8d6',      // Light blue
            },
            shelterStyle: 'classic',  // Colored background with white icon
            headerStyle: 'gradient',  // Filled gradient header with white text
        },
    },

    // ========================================
    // SAKURAZAKA46 - "The Bloom" Theme
    // Artistic, Cool, Ephemeral, Clean white canvas
    // ========================================
    sakurazaka: {
        id: 'sakurazaka',
        name: 'Sakurazaka46',
        nameJp: '櫻坂46',

        primaryColor: groupTokens.sakurazaka.accent,      // Sakura Pink
        secondaryColor: '#FFFFFF',    // Pure White
        accentColor: '#8B9DC3',       // Cool grey-blue

        ambient: {
            orb1: {
                color: 'radial-gradient(circle, #FFF5F8 0%, #FFECF1 30%, transparent 70%)',
                position: 'top: -15%; right: -10%;',
                size: '65vw',
                opacity: 0.5,
            },
            orb2: {
                color: 'radial-gradient(circle, #F8F9FC 0%, #EEF1F8 40%, transparent 70%)',
                position: 'top: 30%; left: -20%;',
                size: '55vw',
                opacity: 0.4,
            },
            orb3: {
                color: 'radial-gradient(circle, #FFE8EF 0%, transparent 70%)',
                position: 'bottom: -20%; right: 20%;',
                size: '45vw',
                opacity: 0.35,
            },
        },

        surface: {
            background: '#FAFBFC',
            card: 'rgba(255, 255, 255, 0.94)',
            glass: 'rgba(255, 255, 255, 0.82)',
            glassBorder: 'rgba(247, 166, 201, 0.2)',
        },

        text: {
            primary: '#2d2d3a',
            secondary: '#5a5a6e',
            muted: '#9898a8',
        },

        interaction: {
            hoverGlow: groupTokens.sakurazaka.glow,
            focusRing: groupTokens.sakurazaka.ring,
            buttonGradient: 'linear-gradient(135deg, #f7a6c9 0%, #e8829e 100%)',
        },

        vibe: ['artistic', 'ephemeral', 'clean canvas', 'cherry blossom', 'cool elegance'],

        blog: {
            memberNameColor: '#d4729c',
            linkColor: '#d4729c',
            linkUnderlineColor: '#d4729c40',
            headerTitleColor: '#d4729c',
            timelineIndicator: '#d4729c',
        },

        modals: {
            accentColor: '#d892aa',       // Sakura pink - matches header text
            accentColorLight: '#fce7f3',  // Light pink for backgrounds
            accentColorMuted: '#f5d0dc',  // Muted pink for borders
        },

        messages: {
            headerGradient: { ...groupTokens.sakurazaka.title.gradient },
            headerTextColor: groupTokens.sakurazaka.title.text,           // Pink member name color
            headerBarGradient: groupTokens.sakurazaka.title.bar,  // Official 5-point gradient with pure white start
            bubbleBorder: groupTokens.sakurazaka.bubbleBorder,              // Pink message bubble border
            voicePlayerAccent: '#d695ec',         // Purple/violet voice player
            scrollButtonColor: '#D4879B',         // Dusty rose scroll button
            unreadShadow: '0 0 12px rgba(232, 82, 152, 0.35)',
            defaultBackground: '#FFFFFF',         // Clean white background
            unreadBadge: groupTokens.sakurazaka.badge,
            sidebarGradient: [...groupTokens.sakurazaka.canvas],
            shelterColors: {
                picture: '#ec9595',   // Salmon pink (from official app)
                video: '#edc094',     // Orange/amber (from official app)
                voice: '#d695ec',     // Purple/violet (from official app)
                text: '#eb95ae',      // Pink (from official app)
            },
            shelterStyle: 'light',    // White background with colored icon (Sakura style)
            headerStyle: 'light',     // White/light background with colored text (Sakura style)
        },
    },

    // ========================================
    // NOGIZAKA46 - "The Elegant" Theme
    // Sophisticated, French Aesthetic, Mature
    // ========================================
    nogizaka: {
        id: 'nogizaka',
        name: 'Nogizaka46',
        nameJp: '乃木坂46',

        primaryColor: groupTokens.nogizaka.accent,      // Noble Purple
        secondaryColor: '#9B59B6',    // Soft Purple
        accentColor: '#E8E0F0',       // Misty Lavender

        ambient: {
            orb1: {
                color: 'radial-gradient(circle, #F3E8F5 0%, #EDE4F2 30%, transparent 70%)',
                position: 'top: -18%; left: -8%;',
                size: '68vw',
                opacity: 0.5,
            },
            orb2: {
                color: 'radial-gradient(circle, #FAFAFA 0%, #F5F5F8 40%, transparent 70%)',
                position: 'top: 25%; right: -18%;',
                size: '58vw',
                opacity: 0.45,
            },
            orb3: {
                color: 'radial-gradient(circle, #F0E6F4 0%, transparent 70%)',
                position: 'bottom: -22%; left: 35%;',
                size: '48vw',
                opacity: 0.38,
            },
        },

        surface: {
            background: '#FCFBFD',
            card: 'rgba(255, 255, 255, 0.93)',
            glass: 'rgba(255, 255, 255, 0.8)',
            glassBorder: 'rgba(126, 16, 131, 0.15)',
        },

        text: {
            primary: '#2a2535',
            secondary: '#5c5666',
            muted: '#8e889a',
        },

        interaction: {
            hoverGlow: groupTokens.nogizaka.glow,
            focusRing: groupTokens.nogizaka.ring,
            buttonGradient: 'linear-gradient(135deg, #9B59B6 0%, #7e1083 100%)',
        },

        vibe: ['sophisticated', 'french', 'mature', 'noble', 'elegant'],

        blog: {
            memberNameColor: '#7e5c91',
            linkColor: '#7e5c91',
            linkUnderlineColor: '#7e5c9140',
            headerTitleColor: '#7e5c91',
            timelineIndicator: '#7e5c91',
        },

        modals: {
            accentColor: '#9B59B6',       // Noble purple - primary accent
            accentColorLight: '#f3e8f5',  // Light lavender for backgrounds
            accentColorMuted: '#d8c8e8',  // Muted purple for borders
        },

        messages: {
            headerGradient: { ...groupTokens.nogizaka.title.gradient },
            headerTextColor: groupTokens.nogizaka.title.text,
            headerBarGradient: groupTokens.nogizaka.title.bar,
            bubbleBorder: groupTokens.nogizaka.bubbleBorder,
            voicePlayerAccent: '#9B59B6',
            scrollButtonColor: '#9B59B6',
            unreadShadow: '0 0 12px rgba(155, 89, 182, 0.35)',
            defaultBackground: '#F8F5FA',
            unreadBadge: groupTokens.nogizaka.badge,
            sidebarGradient: [...groupTokens.nogizaka.canvas],
            shelterColors: {
                picture: '#c4a8d8',   // Soft purple
                video: '#9B59B6',     // Noble purple
                voice: '#b8a8d8',     // Light lavender
                text: '#d8c8e8',      // Misty purple
            },
            shelterStyle: 'classic',  // Colored background with white icon
            headerStyle: 'gradient',  // Filled gradient header with white text
        },
    },

    // ========================================
    // YODEL - "The Meadow" Theme
    // Fresh, Natural, Independent, Green pastures
    // ========================================
    yodel: {
        id: 'yodel',
        name: 'Yodel',
        nameJp: 'ヨーデル',

        primaryColor: groupTokens.yodel.accent,      // Sage Green
        secondaryColor: '#7ab08a',    // Light Sage
        accentColor: '#d4ebe0',       // Soft Mint

        ambient: {
            orb1: {
                color: 'radial-gradient(circle, #e0f2e8 0%, #d4ebe0 30%, transparent 70%)',
                position: 'top: -18%; left: -8%;',
                size: '68vw',
                opacity: 0.45,
            },
            orb2: {
                color: 'radial-gradient(circle, #f5faf7 0%, #eaf5ef 40%, transparent 70%)',
                position: 'top: 25%; right: -18%;',
                size: '58vw',
                opacity: 0.4,
            },
            orb3: {
                color: 'radial-gradient(circle, #d9f0e3 0%, transparent 70%)',
                position: 'bottom: -22%; left: 30%;',
                size: '48vw',
                opacity: 0.35,
            },
        },

        surface: {
            background: '#FBFDFC',
            card: 'rgba(255, 255, 255, 0.92)',
            glass: 'rgba(255, 255, 255, 0.78)',
            glassBorder: 'rgba(90, 138, 106, 0.18)',
        },

        text: {
            primary: '#1a2e22',
            secondary: '#4b5e53',
            muted: '#8fa399',
        },

        interaction: {
            hoverGlow: groupTokens.yodel.glow,
            focusRing: groupTokens.yodel.ring,
            buttonGradient: 'linear-gradient(135deg, #7ab08a 0%, #5a8a6a 100%)',
        },

        vibe: ['fresh', 'natural', 'independent', 'meadow', 'serene'],

        blog: {
            memberNameColor: '#4a7a5a',
            linkColor: '#4a7a5a',
            linkUnderlineColor: '#4a7a5a40',
            headerTitleColor: '#4a7a5a',
            timelineIndicator: '#4a7a5a',
        },

        modals: {
            accentColor: '#5a8a6a',
            accentColorLight: '#e0f2e8',
            accentColorMuted: '#b8d8c8',
        },

        messages: {
            headerGradient: { ...groupTokens.yodel.title.gradient },
            headerTextColor: groupTokens.yodel.title.text,
            headerBarGradient: groupTokens.yodel.title.bar,
            bubbleBorder: groupTokens.yodel.bubbleBorder,
            voicePlayerAccent: '#5a8a6a',
            scrollButtonColor: '#5a8a6a',
            unreadShadow: '0 0 12px rgba(90, 138, 106, 0.35)',
            defaultBackground: '#EAF0EC',
            unreadBadge: groupTokens.yodel.badge,
            sidebarGradient: [...groupTokens.yodel.canvas],
            shelterColors: {
                picture: '#8ab89a',
                video: '#6a9a7a',
                voice: '#7aaa8a',
                text: '#5a8a6a',
            },
            shelterStyle: 'classic',
            headerStyle: 'gradient',
        },
    },

    // ========================================
    // DEFAULT - Neutral fallback
    // ========================================
    default: {
        id: 'default',
        name: 'Default',
        nameJp: '',

        primaryColor: groupTokens.default.accent,
        secondaryColor: '#9CA3AF',
        accentColor: '#E5E7EB',

        ambient: {
            orb1: {
                color: 'radial-gradient(circle, #F3F4F6 0%, #E5E7EB 30%, transparent 70%)',
                position: 'top: -20%; left: -10%;',
                size: '70vw',
                opacity: 0.4,
            },
            orb2: {
                color: 'radial-gradient(circle, #F9FAFB 0%, #F3F4F6 40%, transparent 70%)',
                position: 'top: 20%; right: -15%;',
                size: '60vw',
                opacity: 0.35,
            },
            orb3: {
                color: 'radial-gradient(circle, #F3F4F6 0%, transparent 70%)',
                position: 'bottom: -25%; left: 30%;',
                size: '50vw',
                opacity: 0.3,
            },
        },

        surface: {
            background: '#FAFAFA',
            card: 'rgba(255, 255, 255, 0.9)',
            glass: 'rgba(255, 255, 255, 0.75)',
            glassBorder: 'rgba(0, 0, 0, 0.08)',
        },

        text: {
            primary: '#1F2937',
            secondary: '#4B5563',
            muted: '#9CA3AF',
        },

        interaction: {
            hoverGlow: groupTokens.default.glow,
            focusRing: groupTokens.default.ring,
            buttonGradient: 'linear-gradient(135deg, #6B7280 0%, #4B5563 100%)',
        },

        vibe: ['neutral', 'minimal', 'professional'],

        blog: {
            memberNameColor: '#6B7280',
            linkColor: '#6B7280',
            linkUnderlineColor: '#6B728040',
            headerTitleColor: '#6B7280',
            timelineIndicator: '#6B7280',
        },

        modals: {
            accentColor: '#6B7280',       // Gray - neutral accent
            accentColorLight: '#f3f4f6',  // Light gray for backgrounds
            accentColorMuted: '#e5e7eb',  // Muted gray for borders
        },

        messages: {
            headerGradient: { ...groupTokens.default.title.gradient },
            headerTextColor: groupTokens.default.title.text,
            headerBarGradient: groupTokens.default.title.bar,
            bubbleBorder: groupTokens.default.bubbleBorder,
            voicePlayerAccent: '#6da0d4',
            scrollButtonColor: '#6B7280',
            unreadShadow: '0 0 12px rgba(107, 114, 128, 0.25)',
            defaultBackground: '#E2E6EB',
            unreadBadge: groupTokens.default.badge,
            sidebarGradient: [...groupTokens.default.canvas],
            shelterColors: {
                picture: '#a8d0e8',   // Sky blue
                video: '#c4a8d8',     // Lavender/purple
                voice: '#b8a8d8',     // Light purple
                text: '#8bb8d6',      // Light blue
            },
            shelterStyle: 'classic',  // Colored background with white icon
            headerStyle: 'gradient',  // Filled gradient header with white text
        },
    },
};

// Map service IDs to service themes
export function getServiceTheme(serviceId: string | null): ServiceTheme {
    if (!serviceId) return serviceThemes.default;

    const serviceLower = serviceId.toLowerCase();

    if (serviceLower.includes('hinata') || serviceLower.includes('hinatazaka')) {
        return serviceThemes.hinatazaka;
    }
    if (serviceLower.includes('sakura') || serviceLower.includes('sakurazaka')) {
        return serviceThemes.sakurazaka;
    }
    if (serviceLower.includes('nogi') || serviceLower.includes('nogizaka')) {
        return serviceThemes.nogizaka;
    }
    if (serviceLower.includes('yodel')) {
        return serviceThemes.yodel;
    }

    return serviceThemes.default;
}

// Export theme CSS variables for use in components
export function getServiceThemeCSSVariables(theme: ServiceTheme): Record<string, string> {
    return {
        '--theme-primary': theme.primaryColor,
        '--theme-secondary': theme.secondaryColor,
        '--theme-accent': theme.accentColor,
        '--theme-bg': theme.surface.background,
        '--theme-card': theme.surface.card,
        '--theme-glass': theme.surface.glass,
        '--theme-glass-border': theme.surface.glassBorder,
        '--theme-text-primary': theme.text.primary,
        '--theme-text-secondary': theme.text.secondary,
        '--theme-text-muted': theme.text.muted,
        '--theme-hover-glow': theme.interaction.hoverGlow,
        '--theme-focus-ring': theme.interaction.focusRing,
        '--theme-button-gradient': theme.interaction.buttonGradient,
    };
}

/** Default shelter colors for fallback (matches default/hinatazaka theme) */
export const DEFAULT_SHELTER_COLORS = serviceThemes.default.messages.shelterColors;
