// frontend/src/data/memberColors.ts
// Backward compatibility layer - re-exports from memberData.ts
// New code should import directly from memberData.ts

import {
    getColorPalette,
    getColor,
    resolveColorHex,
    getMembers,
    getMemberByBlogId,
    getMemberByName,
    getMemberPenlightHex,
    getMemberNameKanji,
    getPenlightGradient,
    getPenlightGlow,
    type MemberData,
    type GroupId as MemberGroupId,
} from './memberData';

// ============================================================================
// Re-export Types
// ============================================================================

export type { MemberGroupId };

/**
 * Oshi color definition with Japanese and English names
 * @deprecated Use ColorDefinition from memberData.ts
 */
export interface OshiColor {
    id: string;
    nameJp: string;
    nameEn: string;
    hex: string;
}

/**
 * @deprecated Use MemberData from memberData.ts
 */
export interface MemberColor {
    id: string;
    nameJp: string;
    nameEn: string;
    generation: string;
    penlightHex: [string, string];
}

// ============================================================================
// Generation Labels (backward compatible)
// ============================================================================

export const GENERATION_LABELS: Record<string, string> = {
    '1st': '1st Gen',
    '2nd': '2nd Gen',
    '3rd': '3rd Gen',
    '4th': '4th Gen',
    '5th': '5th Gen',
};

// ============================================================================
// Oshi Color Palette (backward compatible)
// ============================================================================

/**
 * Official penlight color palette with Japanese and English names
 * Defaults to hinatazaka palette for backward compatibility
 */
export const OSHI_COLOR_PALETTE: OshiColor[] = getColorPalette('hinatazaka');

/**
 * Quick lookup map: color id/nameJp/nameEn → OshiColor
 */
export const OSHI_COLOR_MAP: Map<string, OshiColor> = new Map(
    OSHI_COLOR_PALETTE.flatMap(c => [
        [c.id, c],
        [c.nameJp, c],
        [c.nameEn, c],
        [c.nameEn.toLowerCase(), c],
    ])
);

/**
 * Get hex color from color name (id, Japanese, or English)
 */
export function getOshiColorHex(colorName: string): string | null {
    return resolveColorHex(colorName, 'hinatazaka');
}

/**
 * Get full color info from color name
 */
export function getOshiColor(colorName: string): OshiColor | null {
    return getColor(colorName, 'hinatazaka');
}

// ============================================================================
// Member Data (backward compatible)
// ============================================================================

/**
 * Convert MemberData to legacy MemberColor format
 */
function toMemberColor(member: MemberData, group: MemberGroupId): MemberColor {
    const penlightHex = getMemberPenlightHex(member, group);
    const genStr = member.generation === 1 ? '1st' :
                   member.generation === 2 ? '2nd' :
                   member.generation === 3 ? '3rd' :
                   member.generation === 4 ? '4th' : '5th';
    return {
        id: member.blogId,
        nameJp: member.nameKanji,
        nameEn: member.nameRomaji,
        generation: genStr,
        penlightHex,
    };
}

/**
 * All members in legacy format
 * Defaults to Hinatazaka for backward compatibility
 * @deprecated Use getMembers() from memberData.ts
 */
export const MEMBER_COLORS: MemberColor[] = getMembers('hinatazaka').map(m => toMemberColor(m, 'hinatazaka'));

/**
 * Lookup map for quick access by member ID, Japanese name, or English name
 * @deprecated Use getMemberByBlogId() or getMemberByName() from memberData.ts
 */
export const MEMBER_COLOR_MAP: Map<string, MemberColor> = new Map(
    MEMBER_COLORS.flatMap(m => [
        [m.id, m],
        [m.nameJp, m],
        [m.nameEn, m],
    ])
);

// ============================================================================
// Multi-Group Helper Functions
// ============================================================================

/**
 * Map service ID to member group ID
 */
export function getGroupFromService(serviceId: string | null): MemberGroupId {
    if (!serviceId) return 'hinatazaka';

    const serviceLower = serviceId.toLowerCase();

    if (serviceLower.includes('hinata') || serviceLower.includes('hinatazaka')) {
        return 'hinatazaka';
    }
    if (serviceLower.includes('sakura') || serviceLower.includes('sakurazaka')) {
        return 'sakurazaka';
    }
    if (serviceLower.includes('nogi') || serviceLower.includes('nogizaka')) {
        return 'nogizaka';
    }

    return 'hinatazaka';
}

/**
 * Get all members for a specific group
 * @deprecated Use getMembers() from memberData.ts
 */
export function getMembersForGroup(groupId: MemberGroupId): MemberColor[] {
    return getMembers(groupId).map(m => toMemberColor(m, groupId));
}

/**
 * Create a lookup map for a specific group
 * @deprecated Use getMemberByBlogId() or getMemberByName() from memberData.ts
 */
export function createGroupMemberMap(groupId: MemberGroupId): Map<string, MemberColor> {
    const members = getMembersForGroup(groupId);
    return new Map(
        members.flatMap(m => [
            [m.id, m],
            [m.nameJp, m],
            [m.nameEn, m],
        ])
    );
}

// ============================================================================
// Lookup Functions (with optional group parameter for multi-group support)
// ============================================================================

/**
 * Get member colors by name (supports ID, Japanese or English name)
 * @deprecated Use getMemberPenlightHex() from memberData.ts
 */
export function getMemberColors(name: string, groupId?: MemberGroupId): [string, string] | null {
    const group = groupId ?? 'hinatazaka';
    const member = getMemberByBlogId(name, group) ?? getMemberByName(name, group);
    if (!member) return null;
    return getMemberPenlightHex(member, group);
}

/**
 * Get kanji-only member name from API name format
 * @deprecated Use getMemberNameKanji() from memberData.ts
 */
export function getMemberNameJp(apiName: string, groupId?: MemberGroupId): string {
    return getMemberNameKanji(apiName, groupId ?? 'hinatazaka');
}

// ============================================================================
// CSS Helper Functions (re-exports)
// ============================================================================

export { getPenlightGradient, getPenlightGlow };
