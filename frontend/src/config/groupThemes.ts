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
