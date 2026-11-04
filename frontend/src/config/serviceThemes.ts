// frontend/src/config/serviceThemes.ts
// Legacy per-feature view of the design tokens. Every colour comes from
// design/tokens (the official layer or groupRoles); this file only adds
// non-colour metadata. New code should read design/tokens directly.

import { GROUP_IDS, groupTokens, type GroupId } from '../design/tokens/groups';
import { groupRoles } from '../design/tokens/roles';
import { ambientLayout } from '../design/tokens/ambient';

export type { GroupId };

interface AmbientOrb {
    color: string;
    position: string;
    size: string;
    opacity: number;
}

export interface ServiceTheme {
    id: GroupId;
    name: string;
    nameJp: string;

    // Core brand colors
    primaryColor: string;     // logo colour
    secondaryColor: string;   // action (step 600)
    accentColor: string;      // subtle (step 50)

    // Ambient background orbs
    ambient: { orb1: AmbientOrb; orb2: AmbientOrb; orb3: AmbientOrb };

    surface: { background: string };
    text: { secondary: string; muted: string };

    interaction: {
        hoverGlow: string;
        buttonGradient: string;
    };

    // Visual vibe keywords
    vibe: string[];

    blog: {
        memberNameColor: string;
        linkColor: string;
        linkUnderlineColor: string;
        headerTitleColor: string;
        timelineIndicator: string;
    };

    // Modal accent colors (Date Search, Favorites, Media, Background, Sent Letters)
    modals: {
        accentColor: string;        // action — buttons, selected states
        accentColorLight: string;   // subtle — backgrounds, hover
        accentColorMuted: string;   // subtleBorder — borders
    };

    messages: {
        headerGradient: { from: string; via: string; to: string };
        headerTextColor: string;
        headerBarGradient: string;
        bubbleBorder: string;
        voicePlayerAccent: string;
        scrollButtonColor: string;
        unreadShadow: string;
        unreadBadge: string;
        sidebarGradient: string[];
        shelterColors: { picture: string; video: string; voice: string; text: string };
        shelterStyle: 'classic' | 'light';
        headerStyle: 'gradient' | 'light';
    };
}

interface ThemeMeta {
    name: string;
    nameJp: string;
    vibe: string[];
}

const THEME_META: Record<GroupId, ThemeMeta> = {
    hinatazaka: {
        name: 'Hinatazaka46', nameJp: '日向坂46',
        vibe: ['airy', 'bright', 'komorebi', 'summer sky', 'gentle warmth'],
    },
    sakurazaka: {
        name: 'Sakurazaka46', nameJp: '櫻坂46',
        vibe: ['artistic', 'ephemeral', 'clean canvas', 'cherry blossom', 'cool elegance'],
    },
    nogizaka: {
        name: 'Nogizaka46', nameJp: '乃木坂46',
        vibe: ['sophisticated', 'french', 'mature', 'noble', 'elegant'],
    },
    yodel: {
        name: 'Yodel', nameJp: 'ヨーデル',
        vibe: ['fresh', 'natural', 'independent', 'meadow', 'serene'],
    },
    default: {
        name: 'Default', nameJp: '',
        vibe: ['neutral', 'minimal', 'professional'],
    },
};

function buildTheme(id: GroupId): ServiceTheme {
    const g = groupTokens[id];
    const o = g.official;
    const r = groupRoles(id);
    const meta = THEME_META[id];
    return {
        id,
        name: meta.name,
        nameJp: meta.nameJp,
        primaryColor: r.logo,
        secondaryColor: r.action,
        accentColor: r.subtle,
        ambient: {
            orb1: { color: r.ambient.orb1, ...ambientLayout[id].orb1 },
            orb2: { color: r.ambient.orb2, ...ambientLayout[id].orb2 },
            orb3: { color: r.ambient.orb3, ...ambientLayout[id].orb3 },
        },
        surface: { background: g.legacyNeutral.surfaceBackground },
        text: { secondary: g.legacyNeutral.textSecondary, muted: g.legacyNeutral.textMuted },
        interaction: { hoverGlow: r.glow, buttonGradient: r.buttonGradient },
        vibe: [...meta.vibe],
        blog: {
            memberNameColor: r.strong,
            linkColor: r.strong,
            linkUnderlineColor: r.linkUnderline,
            headerTitleColor: r.strong,
            timelineIndicator: r.strong,
        },
        modals: { accentColor: r.action, accentColorLight: r.subtle, accentColorMuted: r.subtleBorder },
        messages: {
            headerGradient: { ...o.title.gradient },
            headerTextColor: o.title.text,
            headerBarGradient: o.title.bar,
            bubbleBorder: r.bubbleBorder,
            voicePlayerAccent: r.action,
            scrollButtonColor: r.action,
            unreadShadow: r.unreadShadow,
            unreadBadge: r.action,
            sidebarGradient: [...o.canvas],
            shelterColors: { ...o.shelter },
            shelterStyle: o.shelterStyle,
            headerStyle: o.headerStyle,
        },
    };
}

export const serviceThemes = Object.fromEntries(
    GROUP_IDS.map((id) => [id, buildTheme(id)]),
) as Record<GroupId, ServiceTheme>;

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

/** Default shelter colors for fallback (matches default/hinatazaka theme) */
export const DEFAULT_SHELTER_COLORS = serviceThemes.default.messages.shelterColors;
