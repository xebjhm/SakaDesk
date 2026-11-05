/**
 * Accent roles (spec §3.5): what a component asks for. The context decides the
 * values — brand ink in brand context, the group's scale in group context.
 * Components never read a hue directly.
 */
import { aurora, brandGlow, brandInk, brandUnread } from './brand';
import { color } from './color';
import { groupTokens, type GroupId } from './groups';
import { groupRoles } from './roles';

export interface AccentRoles {
    /** Step 600: primary fill, switches, selection and focus ring. */
    accent: string;
    /** Step 700: links, selected text. */
    strong: string;
    /** Step 50: selected background, hover. */
    subtle: string;
    /** Step 200: selected border. */
    border: string;
    /** Light end of the button gradient (group logo / ink 400). */
    logo: string;
    /** L1 glow colour (rgba). */
    glow: string;
    /** Primary button fill: logo → accent (spec §12 accepted contrast). */
    gradient: string;
    /** Tonal (secondary emphasis) button fill. */
    tonal: string;
    /** Text on the tonal fill (step 800). */
    tonalText: string;
    /** Unread glow box-shadow. */
    unread: string;
    /** Soft fill for empty-state circles and milestone cards. */
    soft: string;
    /** Expressive dialog header fill. */
    header: string;
    /** Text and icons on the expressive header. */
    headerText: string;
    /** Bar under a light header, or 'none'. */
    headerBar: string;
    /** L2 orb fills (radial gradients). */
    orb1: string;
    orb2: string;
    orb3: string;
}

/** sRGB-space mix (gamma-encoded channels, not linear light) of two #rrggbb colours; t = 0 → a, t = 1 → b. */
export function mixHex(a: string, b: string, t: number): string {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

const orb = (c: string) => `radial-gradient(circle, ${c} 0%, transparent 70%)`;

export function brandAccent(): AccentRoles {
    const s = brandInk;
    return {
        accent: s[600], strong: s[700], subtle: s[50], border: s[200], logo: s[400],
        glow: brandGlow,
        gradient: `linear-gradient(135deg, ${s[400]} 0%, ${s[600]} 100%)`,
        tonal: `linear-gradient(135deg, ${s[200]} 0%, ${mixHex(s[400], '#ffffff', 0.35)} 100%)`,
        tonalText: s[800],
        unread: brandUnread,
        soft: aurora.gradient,
        header: aurora.gradient,
        headerText: color.text.primary,
        headerBar: 'none',
        orb1: orb(aurora.orbs[0]), orb2: orb(aurora.orbs[1]), orb3: orb(aurora.orbs[2]),
    };
}

export function groupAccent(id: GroupId): AccentRoles {
    if (id === 'default') return brandAccent();
    const g = groupTokens[id];
    const r = groupRoles(id);
    const t = g.official.title;
    const light = g.official.headerStyle === 'light';
    return {
        accent: r.action, strong: r.strong, subtle: r.subtle, border: r.subtleBorder, logo: r.logo,
        glow: r.glow,
        gradient: `linear-gradient(135deg, ${r.logo} 0%, ${r.action} 100%)`,
        tonal: `linear-gradient(135deg, ${r.subtleBorder} 0%, ${mixHex(r.logo, '#ffffff', 0.35)} 100%)`,
        tonalText: g.scale[800],
        unread: r.unreadShadow,
        soft: `linear-gradient(135deg, ${r.subtle} 0%, ${r.highlight} 100%)`,
        header: light ? color.surface.sheet : `linear-gradient(to right, ${t.gradient.from}, ${t.gradient.via}, ${t.gradient.to})`,
        headerText: light ? t.text : color.text.inverse,
        headerBar: light ? t.bar : 'none',
        orb1: r.ambient.orb1, orb2: r.ambient.orb2, orb3: r.ambient.orb3,
    };
}
