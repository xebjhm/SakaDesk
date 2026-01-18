// frontend/src/config/groupThemes.ts
// Multi-Group Theme Engine - Visual identity for each idol group

export type GroupId = 'hinatazaka' | 'sakurazaka' | 'nogizaka' | 'default';

export interface GroupTheme {
    id: GroupId;
    name: string;
    nameJp: string;

    // Core brand colors
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
    };
}

export const groupThemes: Record<GroupId, GroupTheme> = {
    // ========================================
    // HINATAZAKA46 - "The Sky" Theme
    // Airy, Happy, Sunlight through trees (Komorebi)
    // ========================================
    hinatazaka: {
        id: 'hinatazaka',
        name: 'Hinatazaka46',
        nameJp: '日向坂46',

        primaryColor: '#7cc7e8',      // Sorairo (Sky Blue)
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
            hoverGlow: 'rgba(124, 199, 232, 0.35)',
            focusRing: '#7cc7e8',
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

        messages: {
            headerGradient: {
                from: '#a8c4e8',
                via: '#a0a9d8',
                to: '#9181c4',
            },
            headerTextColor: '#5d95ae',
            headerBarGradient: 'linear-gradient(to right, #a8c4e8, #9181c4)',
            bubbleBorder: '#7cc7e8',
            voicePlayerAccent: '#6da0d4',
            scrollButtonColor: '#7cc7e8',
            unreadShadow: '0 0 12px rgba(124, 199, 232, 0.4)',
            defaultBackground: '#E2E6EB',
            unreadBadge: '#7cc7e8',
            sidebarGradient: ['#c8d8ec', '#dde6f0', '#f0f4f8'],
            shelterColors: {
                picture: '#a8d0e8',   // Sky blue
                video: '#c4a8d8',     // Lavender/purple
                voice: '#b8a8d8',     // Light purple
                text: '#8bb8d6',      // Light blue
            },
            shelterStyle: 'classic',  // Colored background with white icon
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

        primaryColor: '#f7a6c9',      // Sakura Pink
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
            hoverGlow: 'rgba(247, 166, 201, 0.35)',
            focusRing: '#f7a6c9',
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

        messages: {
            headerGradient: {
                from: '#E85298',
                via: '#c44e8a',
                to: '#9B7BB8',
            },
            headerTextColor: '#E85298',           // Pink header text (from screenshot)
            headerBarGradient: 'linear-gradient(to right, #E85298, #9B7BB8)',  // Pink to purple bar
            bubbleBorder: '#E85298',              // Pink message bubble border
            voicePlayerAccent: '#9B7BB8',         // Purple/violet voice player
            scrollButtonColor: '#D4879B',         // Dusty rose scroll button
            unreadShadow: '0 0 12px rgba(232, 82, 152, 0.35)',
            defaultBackground: '#FFFFFF',         // Clean white background
            unreadBadge: '#E85298',
            sidebarGradient: ['#fce7f3', '#fdf2f8', '#fff5f7'],
            shelterColors: {
                picture: '#E85298',   // Sakura pink (matches bubble border)
                video: '#D49B57',     // Orange/amber (from screenshot)
                voice: '#9B7BB8',     // Purple/violet (matches voice accent)
                text: '#D4879B',      // Dusty rose/pink
            },
            shelterStyle: 'light',    // White background with colored icon (Sakura style)
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

        primaryColor: '#7e1083',      // Noble Purple
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
            hoverGlow: 'rgba(126, 16, 131, 0.28)',
            focusRing: '#9B59B6',
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

        messages: {
            headerGradient: {
                from: '#d8c8e8',
                via: '#c4a8d8',
                to: '#9B59B6',
            },
            headerTextColor: '#7e1083',
            headerBarGradient: 'linear-gradient(to right, #9B59B6, #7e1083)',
            bubbleBorder: '#9B59B6',
            voicePlayerAccent: '#9B59B6',
            scrollButtonColor: '#9B59B6',
            unreadShadow: '0 0 12px rgba(155, 89, 182, 0.35)',
            defaultBackground: '#F8F5FA',
            unreadBadge: '#9B59B6',
            sidebarGradient: ['#ede4f2', '#f3eef6', '#f8f5fa'],
            shelterColors: {
                picture: '#c4a8d8',   // Soft purple
                video: '#9B59B6',     // Noble purple
                voice: '#b8a8d8',     // Light lavender
                text: '#d8c8e8',      // Misty purple
            },
            shelterStyle: 'classic',  // Colored background with white icon
        },
    },

    // ========================================
    // DEFAULT - Neutral fallback
    // ========================================
    default: {
        id: 'default',
        name: 'Default',
        nameJp: '',

        primaryColor: '#6B7280',
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
            hoverGlow: 'rgba(107, 114, 128, 0.25)',
            focusRing: '#6B7280',
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

        messages: {
            headerGradient: {
                from: '#a8c4e8',
                via: '#a0a9d8',
                to: '#9181c4',
            },
            headerTextColor: '#4B5563',
            headerBarGradient: 'linear-gradient(to right, #a8c4e8, #9181c4)',
            bubbleBorder: '#E5E7EB',
            voicePlayerAccent: '#6da0d4',
            scrollButtonColor: '#6B7280',
            unreadShadow: '0 0 12px rgba(107, 114, 128, 0.25)',
            defaultBackground: '#E2E6EB',
            unreadBadge: '#6B7280',
            sidebarGradient: ['#e5e7eb', '#f3f4f6', '#f9fafb'],
            shelterColors: {
                picture: '#a8d0e8',   // Sky blue
                video: '#c4a8d8',     // Lavender/purple
                voice: '#b8a8d8',     // Light purple
                text: '#8bb8d6',      // Light blue
            },
            shelterStyle: 'classic',  // Colored background with white icon
        },
    },
};

// Map service IDs to group themes
export function getThemeForService(serviceId: string | null): GroupTheme {
    if (!serviceId) return groupThemes.default;

    const serviceLower = serviceId.toLowerCase();

    if (serviceLower.includes('hinata') || serviceLower.includes('hinatazaka')) {
        return groupThemes.hinatazaka;
    }
    if (serviceLower.includes('sakura') || serviceLower.includes('sakurazaka')) {
        return groupThemes.sakurazaka;
    }
    if (serviceLower.includes('nogi') || serviceLower.includes('nogizaka')) {
        return groupThemes.nogizaka;
    }

    return groupThemes.default;
}

// Export theme CSS variables for use in components
export function getThemeCSSVariables(theme: GroupTheme): Record<string, string> {
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
