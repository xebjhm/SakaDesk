// frontend/src/config/serviceThemes.ts
// Legacy per-feature view kept for the chat, the login dialog and the legacy
// CSS variables (`messages` and the brand colours). New code reads design/tokens.

import { GROUP_IDS, groupTokens, type GroupId } from '../design/tokens/groups';
import { groupRoles } from '../design/tokens/roles';
import { serviceGroupId } from './serviceGroup';

export type { GroupId };

export interface ServiceTheme {
    id: GroupId;
    name: string;
    nameJp: string;

    // Core brand colors
    primaryColor: string;     // logo colour
    secondaryColor: string;   // action (step 600)
    accentColor: string;      // subtle (step 50)

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
}

const THEME_META: Record<GroupId, ThemeMeta> = {
    hinatazaka: {
        name: 'Hinatazaka46', nameJp: '日向坂46',
    },
    sakurazaka: {
        name: 'Sakurazaka46', nameJp: '櫻坂46',
    },
    nogizaka: {
        name: 'Nogizaka46', nameJp: '乃木坂46',
    },
    yodel: {
        name: 'Yodel', nameJp: 'ヨーデル',
    },
    default: {
        name: 'Default', nameJp: '',
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
    return serviceThemes[serviceGroupId(serviceId)];
}

/** Default shelter colors for fallback (matches default/hinatazaka theme) */
export const DEFAULT_SHELTER_COLORS = serviceThemes.default.messages.shelterColors;
