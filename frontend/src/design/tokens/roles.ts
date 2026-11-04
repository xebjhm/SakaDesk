/**
 * Role → scale-step mapping, identical for every group. This is the ONLY
 * place the mapping lives; components and the legacy theme read roles,
 * never raw steps.
 */
import { groupTokens, SAKAMICHI_GROUPS, SAKAMICHI_PURPLE, type GroupId } from './groups';

export interface GroupRoles {
    /** Brand / logo colour (decoration, gradients). */
    logo: string;
    /** Step 600: badge, primary button, play button, scroll button (white text ≥ 3:1). */
    action: string;
    /** Step 700: member names, links, selected text (≥ 4.5:1 on white). */
    strong: string;
    /** Step 50: selected / hover background. */
    subtle: string;
    /** Step 200: border of subtle selections. */
    subtleBorder: string;
    /** Step 100: landed-row highlight (`animate-landing`). */
    highlight: string;
    /** Step 300: link underline. */
    linkUnderline: string;
    bubbleBorder: string;
    glow: string;
    /** Step 600: keyboard focus ring. */
    ring: string;
    unreadShadow: string;
    ambient: { orb1: string; orb2: string; orb3: string };
}

function hexToRgba(hex: string, alpha: number): string {
    const value = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function groupRoles(id: GroupId): GroupRoles {
    const g = groupTokens[id];
    const s = g.scale;
    const orb2Core = SAKAMICHI_GROUPS.includes(id) ? SAKAMICHI_PURPLE[100] : s[100];
    return {
        logo: g.logo,
        action: s[600],
        strong: s[700],
        subtle: s[50],
        subtleBorder: s[200],
        highlight: s[100],
        linkUnderline: s[300],
        bubbleBorder: g.bubbleBorder,
        glow: g.glow,
        ring: s[600],
        unreadShadow: `0 0 12px ${hexToRgba(g.logo, 0.4)}`,
        ambient: {
            orb1: `radial-gradient(circle, ${s[200]} 0%, ${s[100]} 30%, transparent 70%)`,
            orb2: `radial-gradient(circle, ${orb2Core} 0%, ${s[50]} 40%, transparent 70%)`,
            orb3: `radial-gradient(circle, ${s[100]} 0%, transparent 70%)`,
        },
    };
}

/** Action colour for media controls rendered without a group theme. */
export const FALLBACK_ACTION_COLOR = groupTokens.default.scale[600];
