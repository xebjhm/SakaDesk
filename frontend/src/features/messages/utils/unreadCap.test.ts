import { describe, it, expect } from 'vitest';
import { capUnreadToServer } from './unreadCap';

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
