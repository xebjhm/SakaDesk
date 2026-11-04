/** Hinatazaka46's mascot ポカ: blog id 000. It has no member data, penlight or local thumbnail. */
export function isMascot(member: { id: string; name: string }): boolean {
    return member.id === '000' || member.name === 'ポカ';
}

/** ポカ's thumbnail on the official site (the archive has none). */
export const MASCOT_THUMBNAIL_URL = 'https://cdn.hinatazaka46.com/images/14/98b/e96b48f630edc3119806a1b40bc10/400_320_102400.jpg';
