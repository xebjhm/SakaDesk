/**
 * Cap a locally-computed unread count by the server's last-known unread snapshot.
 *
 * The server count (captured each sync from the official API) reflects reads done
 * on the official mobile app, so capping makes the SakaDesk badge follow the phone
 * (phone -> Windows). It only ever lowers the count to match whoever read more —
 * never resurrects unread. When the server snapshot is unknown (null/undefined —
 * the group was never synced, or the metadata predates this feature) the local
 * count is returned unchanged so we never hide genuine unread.
 */
export function capUnreadToServer(
    local: number,
    serverUnread: number | null | undefined,
): number {
    if (serverUnread == null) return local;
    return Math.min(local, serverUnread);
}

export interface UnreadEntry {
    /** Unique, service-scoped conversation path (e.g. "日向坂46/messages/79 …"). */
    path: string;
    /** Server's last-synced unread for this conversation (phone -> Windows). */
    serverUnread: number | null | undefined;
}

/**
 * Build the unread-badge map keyed by each conversation's unique PATH.
 *
 * Talk-room ids are only unique within a service, so the same numeric id can
 * belong to two different conversations across services (e.g. a Sakurazaka
 * member DM and a Hinatazaka group chat both id 79). Keying by id lets one
 * conversation's count bleed onto the other's badge — so we key by path, which
 * is service-scoped and unique. Each entry is capped to its own server snapshot.
 */
export function computeUnreadByPath(
    entries: UnreadEntry[],
    backendCounts: Record<string, number>,
): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const e of entries) {
        const unread = capUnreadToServer(backendCounts[e.path] || 0, e.serverUnread);
        if (unread > 0) counts[e.path] = unread;
    }
    return counts;
}
