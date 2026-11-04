/** One sent letter from the local archive (`GET /api/chat/letters_local`). */
export interface Letter {
    id: number;
    text: string;
    /** ISO timestamp (UTC). */
    created_at: string;
    /** Media-route URL of the archived letter image; null when the file is missing. */
    image_url: string | null;
    width: number | null;
    height: number | null;
}

/** One of the account's archived avatars (`GET /api/account/profile`). */
export interface AccountAvatar {
    /** Media-route URL (never the signed CDN URL). */
    url: string;
    first_seen: string;
}

export interface AccountProfile {
    name: string | null;
    avatars: AccountAvatar[];
}

/** A letter image is shown this wide in the chat. */
export const LETTER_WIDTH = 180;
const DEFAULT_LETTER_HEIGHT = 240;

/** Height (px) reserved for a letter image shown LETTER_WIDTH wide, so landings do not drift. */
export function letterImageHeight(letter: Pick<Letter, 'width' | 'height'>): number {
    return letter.width && letter.height
        ? Math.round((LETTER_WIDTH * letter.height) / letter.width)
        : DEFAULT_LETTER_HEIGHT;
}

export async function fetchLocalLetters(service: string, memberPath: string, signal?: AbortSignal): Promise<Letter[]> {
    const params = new URLSearchParams({ service, path: memberPath });
    const res = await fetch(`/api/chat/letters_local?${params}`, { signal });
    if (!res.ok) throw new Error(`letters_local ${res.status}`);
    const data = await res.json() as { letters?: Letter[] };
    return data.letters ?? [];
}

export async function fetchAccountProfile(service: string, signal?: AbortSignal): Promise<AccountProfile> {
    const res = await fetch(`/api/account/profile?${new URLSearchParams({ service })}`, { signal });
    if (!res.ok) throw new Error(`account_profile ${res.status}`);
    const data = await res.json() as Partial<AccountProfile>;
    return { name: data.name ?? null, avatars: data.avatars ?? [] };
}

export type AvatarSource = 'history' | 'fallback' | 'none';

/**
 * The user's avatar when a letter was sent: the newest one whose first_seen is at or before
 * `createdAt` ('history'); if none qualifies, the earliest known one ('fallback').
 */
export function pickLetterAvatar(
    avatars: readonly AccountAvatar[],
    createdAt: string,
): { url: string | null; source: AvatarSource } {
    const sent = Date.parse(createdAt);
    let best: { url: string; seen: number } | null = null;
    let earliest: { url: string; seen: number } | null = null;
    for (const avatar of avatars) {
        const seen = Date.parse(avatar.first_seen);
        if (Number.isNaN(seen)) continue;
        if (!earliest || seen < earliest.seen) earliest = { url: avatar.url, seen };
        if (!Number.isNaN(sent) && seen <= sent && (!best || seen > best.seen)) best = { url: avatar.url, seen };
    }
    if (best) return { url: best.url, source: 'history' };
    if (earliest) return { url: earliest.url, source: 'fallback' };
    return { url: null, source: 'none' };
}

/**
 * pickLetterAvatar for every letter the timeline shows, plus how many there are (`count`) and
 * how many came from the history vs the fallback (for the breadcrumb). Letters with an
 * unparseable created_at never render (buildTimeline drops them), so they are skipped.
 */
export function letterAvatars(letters: readonly Letter[], avatars: readonly AccountAvatar[]) {
    const byId = new Map<number, string | null>();
    let history = 0;
    let fallback = 0;
    for (const letter of letters) {
        if (Number.isNaN(Date.parse(letter.created_at))) continue;
        const pick = pickLetterAvatar(avatars, letter.created_at);
        byId.set(letter.id, pick.url);
        if (pick.source === 'history') history += 1;
        else if (pick.source === 'fallback') fallback += 1;
    }
    return { byId, count: byId.size, history, fallback };
}
