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
