import { describe, it, expect } from 'vitest';
import type { Message } from '../../types';
import { decideCall, pickCandidate, type CallDecisionInput } from './callDecision';

const msg = (id: number, timestamp: string, type: Message['type'] = 'voice'): Message => ({
    id, timestamp, type, is_favorite: false, content: null,
    media_file: type === 'voice' ? `messages/1 a/2 b/voice/${id}.m4a` : undefined,
});

const base = (over: Partial<CallDecisionInput> = {}): CallDecisionInput => ({
    enabled: true,
    isGroupChat: false,
    messages: [msg(10, '2026-11-01T10:00:00Z')],
    isUnread: () => true,
    photoUrl: '/img/phone.jpg',
    dismissedIds: new Set<number>(),
    callActive: false,
    ...over,
});

describe('pickCandidate', () => {
    it('ignores non-voice messages', () => {
        expect(pickCandidate([msg(1, '2026-11-02T00:00:00Z', 'text')])).toBeUndefined();
    });

    it('picks by newest timestamp, not by id', () => {
        const older = msg(99, '2026-11-01T00:00:00Z');
        const newer = msg(5, '2026-11-02T00:00:00Z');
        expect(pickCandidate([older, newer])?.id).toBe(5);
        expect(pickCandidate([newer, older])?.id).toBe(5);
    });

    it('breaks a timestamp tie by the larger id', () => {
        const a = msg(7, '2026-11-02T00:00:00Z');
        const b = msg(8, '2026-11-02T00:00:00Z');
        expect(pickCandidate([b, a])?.id).toBe(8);
    });
});

describe('decideCall', () => {
    it('rings for an unread newest voice in a 1:1 chat', () => {
        const d = decideCall(base());
        expect(d).toEqual({ ring: true, message: expect.objectContaining({ id: 10 }) });
    });

    it.each<[string, Partial<CallDecisionInput>]>([
        ['disabled', { enabled: false }],
        ['group_chat', { isGroupChat: true }],
        ['no_voice', { messages: [msg(1, '2026-11-01T00:00:00Z', 'text')] }],
    ])('skips with %s before looking at a candidate', (reason, over) => {
        expect(decideCall(base(over))).toEqual({ ring: false, reason });
    });

    it('skips already_read when the candidate is below lastReadId', () => {
        const readState = { lastReadId: 10, revealedIds: [] as number[] };
        const isUnread = (id: number) => id > readState.lastReadId && !readState.revealedIds.includes(id);
        expect(decideCall(base({ isUnread }))).toEqual({ ring: false, reason: 'already_read', messageId: 10 });
    });

    it('skips already_read when the candidate was revealed individually', () => {
        const readState = { lastReadId: 0, revealedIds: [10] };
        const isUnread = (id: number) => id > readState.lastReadId && !readState.revealedIds.includes(id);
        expect(decideCall(base({ isUnread }))).toEqual({ ring: false, reason: 'already_read', messageId: 10 });
    });

    it('only the newest voice matters: an older unread voice does not ring', () => {
        const messages = [msg(1, '2026-11-01T00:00:00Z'), msg(2, '2026-11-02T00:00:00Z')];
        const isUnread = (id: number) => id === 1;
        expect(decideCall(base({ messages, isUnread }))).toEqual({ ring: false, reason: 'already_read', messageId: 2 });
    });

    it.each([
        ['no_photo', { photoUrl: undefined }],
        ['dismissed_this_visit', { dismissedIds: new Set([10]) }],
        ['call_active', { callActive: true }],
    ] as const)('skips with %s', (reason, over) => {
        expect(decideCall(base(over))).toEqual({ ring: false, reason, messageId: 10 });
    });

    it('checks conditions in spec order (no_photo wins over dismissed)', () => {
        expect(decideCall(base({ photoUrl: undefined, dismissedIds: new Set([10]), callActive: true }))).toEqual({
            ring: false, reason: 'no_photo', messageId: 10,
        });
    });
});
