import { describe, it, expect } from 'vitest';
import { capUnreadToServer, computeUnreadByPath } from './unreadCap';

describe('capUnreadToServer', () => {
    it('returns the local count when the server snapshot is unknown (null)', () => {
        // Group never synced / old metadata → never hide genuine unread.
        expect(capUnreadToServer(3, null)).toBe(3);
    });

    it('returns the local count when the server snapshot is undefined', () => {
        expect(capUnreadToServer(3, undefined)).toBe(3);
    });

    it('caps down to the server count when the phone has read more', () => {
        // Read on phone → server unread dropped to 0 → badge clears.
        expect(capUnreadToServer(3, 0)).toBe(0);
        expect(capUnreadToServer(5, 2)).toBe(2);
    });

    it('keeps the local count when SakaDesk has read more than the phone', () => {
        // Never cap upward: server reporting more unread must not resurrect reads.
        expect(capUnreadToServer(0, 4)).toBe(0);
        expect(capUnreadToServer(2, 5)).toBe(2);
    });

    it('is a no-op when both agree', () => {
        expect(capUnreadToServer(4, 4)).toBe(4);
    });
});

describe('computeUnreadByPath', () => {
    it('does not let a same-id conversation in another service bleed across', () => {
        // Real bug: Sakurazaka member DM (id 79, 39 unread) and Hinatazaka group
        // chat (id 79, 0 unread) share the numeric id. Keyed by path, they stay
        // separate: the hinatazaka LIVE badge must be 0/absent, not 39.
        const entries = [
            { path: '櫻坂46/messages/79 中川 智尋/134 中川 智尋', serverUnread: 39 },
            { path: '日向坂46/messages/79 17th Single LIVE/120 石塚 瑶季', serverUnread: 0 },
        ];
        const backendCounts: Record<string, number> = {
            '櫻坂46/messages/79 中川 智尋/134 中川 智尋': 39,
            '日向坂46/messages/79 17th Single LIVE/120 石塚 瑶季': 39, // local lags the phone
        };

        const counts = computeUnreadByPath(entries, backendCounts);

        expect(counts['日向坂46/messages/79 17th Single LIVE/120 石塚 瑶季']).toBeUndefined();
        expect(counts['櫻坂46/messages/79 中川 智尋/134 中川 智尋']).toBe(39);
    });

    it('omits zero counts and caps each entry to its own server snapshot', () => {
        const counts = computeUnreadByPath(
            [
                { path: 'a', serverUnread: 2 },
                { path: 'b', serverUnread: null },
                { path: 'c', serverUnread: 0 },
            ],
            { a: 5, b: 3, c: 10 },
        );
        expect(counts).toEqual({ a: 2, b: 3 });
    });
});
