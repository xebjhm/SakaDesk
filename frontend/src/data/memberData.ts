// frontend/src/data/memberData.ts
// Single source of truth for member data across all groups

import { COLORS, type ColorDefinition, type GroupId } from '../../../data/colors';
import hinatazakaData from '../../../data/members/hinatazaka.json';
import sakurazakaData from '../../../data/members/sakurazaka.json';
import nogizakaData from '../../../data/members/nogizaka.json';

// ============================================================================
// Types
// ============================================================================

export type { ColorDefinition, GroupId };

export interface MemberData {
    blogId: string;
    nameKanji: string;
    nameHiragana: string;
    nameRomaji: string;
    generation: number;
    oshiColors: string[];
    status: 'active' | 'graduated';
}

export interface MemberDataFile {
    meta: {
        group: string;
        updated: string;
    };
    members: MemberData[];
}

// ============================================================================
// Data Access
// ============================================================================

const COLORS_BY_GROUP = COLORS;

const MEMBERS_BY_GROUP: Record<GroupId, MemberDataFile> = {
    hinatazaka: hinatazakaData as MemberDataFile,
    sakurazaka: sakurazakaData as MemberDataFile,
    nogizaka: nogizakaData as MemberDataFile,
};

// Pre-built lookup maps for performance
const COLOR_MAPS: Record<GroupId, Map<string, ColorDefinition>> = {} as Record<GroupId, Map<string, ColorDefinition>>;
const MEMBER_MAPS: Record<GroupId, Map<string, MemberData>> = {} as Record<GroupId, Map<string, MemberData>>;

function ensureColorMap(group: GroupId): Map<string, ColorDefinition> {
    if (!COLOR_MAPS[group]) {
        COLOR_MAPS[group] = new Map(
            COLORS_BY_GROUP[group].flatMap(c => [
                [c.id, c],
                [c.nameJp, c],
                [c.nameEn, c],
                [c.nameEn.toLowerCase(), c],
            ])
        );
    }
    return COLOR_MAPS[group];
}

function ensureMemberMap(group: GroupId): Map<string, MemberData> {
    if (!MEMBER_MAPS[group]) {
        MEMBER_MAPS[group] = new Map(
            MEMBERS_BY_GROUP[group].members.flatMap(m => [
                [m.blogId, m],
                [m.nameKanji, m],
                [m.nameRomaji, m],
            ])
        );
    }
    return MEMBER_MAPS[group];
}

// ============================================================================
// Color Functions
// ============================================================================

/**
 * Get color palette for a specific group
 */
export function getColorPalette(group: GroupId): ColorDefinition[] {
    return COLORS_BY_GROUP[group] ?? [];
}

/**
 * Get color definition by ID, Japanese name, or English name
 */
export function getColor(colorName: string, group: GroupId): ColorDefinition | null {
    const map = ensureColorMap(group);
    return map.get(colorName) ?? map.get(colorName.toLowerCase()) ?? null;
}

/**
 * Resolve a color ID to its hex value for a specific group
 */
export function resolveColorHex(colorId: string, group: GroupId): string | null {
    return getColor(colorId, group)?.hex ?? null;
}

// ============================================================================
// Member Functions
// ============================================================================

/**
 * Get all members for a specific group
 */
export function getMembers(group: GroupId): MemberData[] {
    return MEMBERS_BY_GROUP[group]?.members ?? [];
}

/**
 * Get active members only for a specific group
 */
export function getActiveMembers(group: GroupId): MemberData[] {
    return getMembers(group).filter(m => m.status === 'active');
}

/**
 * Get member by blog ID
 */
export function getMemberByBlogId(blogId: string, group: GroupId): MemberData | null {
    const map = ensureMemberMap(group);
    return map.get(blogId) ?? null;
}

/**
 * Get member by name (kanji or romaji)
 */
export function getMemberByName(name: string, group: GroupId): MemberData | null {
    const map = ensureMemberMap(group);
    return map.get(name) ?? null;
}

/**
 * Get penlight hex colors for a member
 * Returns tuple of [color1, color2] hex values
 */
export function getMemberPenlightHex(member: MemberData, group: GroupId): [string, string] {
    const [color1Id, color2Id] = member.oshiColors;
    const hex1 = resolveColorHex(color1Id, group) ?? '#ffffff';
    const hex2 = resolveColorHex(color2Id ?? color1Id, group) ?? '#ffffff';
    return [hex1, hex2];
}

/**
 * Get penlight hex colors by member blog ID
 */
export function getPenlightHexByBlogId(blogId: string, group: GroupId): [string, string] | null {
    const member = getMemberByBlogId(blogId, group);
    if (!member) return null;
    return getMemberPenlightHex(member, group);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extract kanji-only from API name format
 * API format: "姓 名せい めい" (kanji with space + hiragana reading)
 */
function extractKanjiFromApiName(apiName: string): string {
    const noSpaces = apiName.replace(/\s+/g, '');
    const kanjiOnly = noSpaces.replace(/[\u3040-\u309F]/g, '');
    return kanjiOnly;
}

/**
 * Get kanji-only member name from API name format
 */
export function getMemberNameKanji(apiName: string, group?: GroupId): string {
    const groups: GroupId[] = group ? [group] : ['hinatazaka', 'sakurazaka', 'nogizaka'];
    const noSpaces = apiName.replace(/\s+/g, '');
    const kanjiOnly = extractKanjiFromApiName(apiName);

    for (const g of groups) {
        const map = ensureMemberMap(g);

        const directMatch = map.get(apiName);
        if (directMatch) return directMatch.nameKanji;

        const noSpacesMatch = map.get(noSpaces);
        if (noSpacesMatch) return noSpacesMatch.nameKanji;

        const kanjiMatch = map.get(kanjiOnly);
        if (kanjiMatch) return kanjiMatch.nameKanji;
    }

    return kanjiOnly || apiName;
}

/**
 * Generate CSS gradient from penlight colors
 */
export function getPenlightGradient(colors: [string, string], angle: number = 135): string {
    return `linear-gradient(${angle}deg, ${colors[0]}, ${colors[1]})`;
}

/**
 * Generate CSS box-shadow glow effect from penlight colors
 */
export function getPenlightGlow(colors: [string, string], intensity: number = 0.5): string {
    const alpha1 = Math.round(intensity * 255).toString(16).padStart(2, '0');
    const alpha2 = Math.round(intensity * 0.5 * 255).toString(16).padStart(2, '0');
    return `0 0 20px ${colors[0]}${alpha1}, 0 0 40px ${colors[1]}${alpha2}`;
}

// ============================================================================
// Service ID to Group ID Conversion
// ============================================================================

/**
 * Convert a service ID (e.g., "sakurazaka46", "hinatazaka46-blogs") to a GroupId.
 * This is the single source of truth for service-to-group mapping.
 */
export function toGroupId(serviceId: string | null): GroupId {
    if (!serviceId) return 'hinatazaka'; // Default fallback

    const serviceLower = serviceId.toLowerCase();

    if (serviceLower.includes('hinata')) {
        return 'hinatazaka';
    }
    if (serviceLower.includes('sakura')) {
        return 'sakurazaka';
    }
    if (serviceLower.includes('nogi')) {
        return 'nogizaka';
    }

    return 'hinatazaka'; // Default fallback
}

// ============================================================================
// Generation Labels
// ============================================================================

export const GENERATION_LABELS: Record<number, string> = {
    1: '1st Gen',
    2: '2nd Gen',
    3: '3rd Gen',
    4: '4th Gen',
    5: '5th Gen',
    6: '6th Gen',
};
