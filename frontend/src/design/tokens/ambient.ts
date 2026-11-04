import type { GroupId } from './groups';

/**
 * Layout of the three ambient orbs behind the blog feed, per group. Colours are the
 * `ambient` role (groupRoles(id).ambient); this is the non-colour part. Values moved
 * verbatim from THEME_META in config/serviceThemes.ts (D2b). `position` is kept for the
 * legacy theme; DynamicBackground places the orbs itself.
 */
export interface OrbLayout {
    position: string;
    size: string;
    opacity: number;
}

export interface AmbientLayout {
    orb1: OrbLayout;
    orb2: OrbLayout;
    orb3: OrbLayout;
}

export const ambientLayout: Record<GroupId, AmbientLayout> = {
    hinatazaka: {
        orb1: { position: 'top: -20%; left: -10%;', size: '70vw', opacity: 0.4 },
        orb2: { position: 'top: 15%; right: -15%;', size: '60vw', opacity: 0.35 },
        orb3: { position: 'bottom: -25%; left: 25%;', size: '50vw', opacity: 0.3 },
    },
    sakurazaka: {
        orb1: { position: 'top: -15%; right: -10%;', size: '65vw', opacity: 0.5 },
        orb2: { position: 'top: 30%; left: -20%;', size: '55vw', opacity: 0.4 },
        orb3: { position: 'bottom: -20%; right: 20%;', size: '45vw', opacity: 0.35 },
    },
    nogizaka: {
        orb1: { position: 'top: -18%; left: -8%;', size: '68vw', opacity: 0.5 },
        orb2: { position: 'top: 25%; right: -18%;', size: '58vw', opacity: 0.45 },
        orb3: { position: 'bottom: -22%; left: 35%;', size: '48vw', opacity: 0.38 },
    },
    yodel: {
        orb1: { position: 'top: -18%; left: -8%;', size: '68vw', opacity: 0.45 },
        orb2: { position: 'top: 25%; right: -18%;', size: '58vw', opacity: 0.4 },
        orb3: { position: 'bottom: -22%; left: 30%;', size: '48vw', opacity: 0.35 },
    },
    default: {
        orb1: { position: 'top: -20%; left: -10%;', size: '70vw', opacity: 0.4 },
        orb2: { position: 'top: 20%; right: -15%;', size: '60vw', opacity: 0.35 },
        orb3: { position: 'bottom: -25%; left: 30%;', size: '50vw', opacity: 0.3 },
    },
};
