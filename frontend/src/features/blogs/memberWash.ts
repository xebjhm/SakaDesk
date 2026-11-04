import type { CSSProperties } from 'react';
import type { BlogMember } from '../../types';
import { getMemberByBlogId, getMemberByName, getMemberPenlightHex, type GroupId } from '../../data/memberData';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** A penlight colour is only passed to CSS when it is a #rrggbb hex; anything else is transparent. */
function safeHex(value: unknown): string {
    return typeof value === 'string' && HEX_COLOR.test(value) ? value : 'transparent';
}

/**
 * CSS variables for the reader's penlight wash (docs/design/DESIGN_SYSTEM.md, "Member
 * penlight colours"): the member's two penlight colours, which the `bg-member-wash` utility
 * mixes in. undefined (no wash) for the mascot ポカ and for members without member data.
 * A colour that is not a #rrggbb hex becomes `transparent`.
 * The lookup is the pre-D2b one: name, name without spaces, then blog id.
 */
export function memberWashStyle(member: BlogMember, groupId: GroupId): CSSProperties | undefined {
    if (member.id === '000' || member.name === 'ポカ') return undefined;
    const data =
        getMemberByName(member.name, groupId) ??
        getMemberByName(member.name.replace(/\s+/g, ''), groupId) ??
        getMemberByBlogId(member.id, groupId);
    if (!data) return undefined;
    const [first, second] = getMemberPenlightHex(data, groupId);
    return { '--ds-member-wash-1': safeHex(first), '--ds-member-wash-2': safeHex(second) } as CSSProperties;
}
