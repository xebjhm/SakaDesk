import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MemberInfo, Message } from '../../types';
import { clientLog } from '../../utils/clientLog';
import {
    useIncomingCall, ENDED_HOLD_MS, RING_TIMEOUT_MS, type CallOutcome, type UseIncomingCallArgs,
} from './useIncomingCall';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
const log = vi.mocked(clientLog);

const voice = (id: number, ts: string): Message => ({
    id, timestamp: ts, type: 'voice', is_favorite: false, content: null,
    media_file: `messages/34 金村 美玖/58 金村 美玖/voice/${id}.m4a`,
});
const member: MemberInfo = { id: 58, name: '金村 美玖', phone_image_local: '/img/phone.jpg' };
const DIR = '日向坂46/messages/34 金村 美玖/58 金村 美玖';

function makeArgs(over: Partial<UseIncomingCallArgs> = {}): UseIncomingCallArgs {
    return {
        service: 'hinatazaka46',
        chatDir: DIR,
        isGroupChat: false,
        messages: [voice(10, '2026-11-01T10:00:00Z')],
        member,
        name: '金村 美玖',
        enabled: true,
        isUnread: () => true,
        freshFetch: { seq: 1, dir: DIR },
        revealMessage: vi.fn(),
        scrollToMessage: vi.fn(),
        logContext: { service: 'hinatazaka46', groupId: 34, memberId: 58 },
        ...over,
    };
}

const events = () => log.mock.calls.map(c => c[0]);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => { vi.useFakeTimers(); log.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

async function ringing(over: Partial<UseIncomingCallArgs> = {}, preload = vi.fn(() => Promise.resolve())) {
    const onOutcome = vi.fn<(o: CallOutcome) => void>();
    const hook = renderHook(({ a }) => useIncomingCall(a, preload), {
        initialProps: { a: makeArgs({ onOutcome, ...over }) },
    });
    await flush();
    return { ...hook, preload, onOutcome };
}

describe('useIncomingCall onOutcome', () => {
    it('reports ringing when the call rings', async () => {
        const { onOutcome } = await ringing();
        expect(onOutcome.mock.calls.map(c => c[0])).toEqual([{ kind: 'ringing' }]);
    });

    it('reports declined', async () => {
        const { result, onOutcome } = await ringing();
        act(() => result.current.decline());
        expect(onOutcome).toHaveBeenLastCalledWith({ kind: 'declined' });
    });

    it('reports timeout after the ring timeout', async () => {
        const { onOutcome } = await ringing();
        act(() => { vi.advanceTimersByTime(RING_TIMEOUT_MS); });
        expect(onOutcome).toHaveBeenLastCalledWith({ kind: 'timeout' });
    });

    it('reports ended only after the ended hold, not at call_end', async () => {
        const { result, onOutcome } = await ringing();
        act(() => result.current.answer());
        act(() => result.current.onPlaybackEnded());
        expect(events()).toContain('call_end');
        expect(onOutcome.mock.calls.map(c => c[0].kind)).toEqual(['ringing']);
        act(() => { vi.advanceTimersByTime(ENDED_HOLD_MS - 1); });
        expect(onOutcome.mock.calls.map(c => c[0].kind)).toEqual(['ringing']);
        act(() => { vi.advanceTimersByTime(1); });
        expect(onOutcome.mock.calls.map(c => c[0].kind)).toEqual(['ringing', 'ended']);
    });

    it('reports cancelled on unmount while ringing', async () => {
        const { unmount, onOutcome } = await ringing();
        unmount();
        expect(onOutcome).toHaveBeenLastCalledWith({ kind: 'cancelled' });
    });

    it('reports cancelled when the setting is turned off while connected', async () => {
        const { result, rerender, onOutcome } = await ringing();
        act(() => result.current.answer());
        rerender({ a: makeArgs({ onOutcome, enabled: false, freshFetch: { seq: 1, dir: DIR } }) });
        expect(onOutcome).toHaveBeenLastCalledWith({ kind: 'cancelled' });
    });

    it('reports a skipped no_photo for a member without images', async () => {
        const { onOutcome } = await ringing({ member: { id: 58, name: '金村 美玖' } });
        expect(onOutcome).toHaveBeenCalledWith({ kind: 'skipped', reason: 'no_photo' });
    });

    it('reports a repeated identical skip twice while logging call_skip once', async () => {
        const { rerender, onOutcome } = await ringing({ member: { id: 58, name: '金村 美玖' } });
        rerender({ a: makeArgs({ onOutcome, member: { id: 58, name: '金村 美玖' }, freshFetch: { seq: 2, dir: DIR } }) });
        await flush();
        expect(onOutcome.mock.calls.filter(c => c[0].kind === 'skipped')).toHaveLength(2);
        expect(log.mock.calls.filter(c => c[0] === 'call_skip')).toHaveLength(1);
    });

    it('reports skipped media_unavailable when the preload fails', async () => {
        const failing = vi.fn(() => Promise.reject(new Error('media_unavailable')));
        const { onOutcome } = await ringing({}, failing);
        expect(onOutcome).toHaveBeenCalledWith({ kind: 'skipped', reason: 'media_unavailable' });
    });

    it('reports skipped already_read when the voice was read during the preload', async () => {
        const { onOutcome } = await ringing({ isUnread: vi.fn().mockReturnValueOnce(true).mockReturnValue(false) });
        expect(onOutcome).toHaveBeenCalledWith({ kind: 'skipped', reason: 'already_read' });
    });
});

describe('useIncomingCall surface', () => {
    it("adds surface 'popup' to every breadcrumb of a ring, answer and end flow", async () => {
        const { result } = await ringing({ surface: 'popup' });
        act(() => result.current.answer());
        act(() => result.current.onPlaybackEnded());
        act(() => { vi.advanceTimersByTime(ENDED_HOLD_MS); });
        expect(events()).toEqual(['call_ring', 'call_answer', 'call_end']);
        expect(log.mock.calls.every(([, f]) => f?.surface === 'popup')).toBe(true);
    });

    it('leaves the payloads untouched without surface', async () => {
        await ringing();
        expect(log).toHaveBeenCalledWith('call_ring', { service: 'hinatazaka46', group_id: 34, member_id: 58, message_id: 10 });
    });
});

describe('useIncomingCall isCallElsewhere', () => {
    it('skips with popup_active and does not ring when the popup owns the voice', async () => {
        const isCallElsewhere = vi.fn(() => Promise.resolve(true));
        const { result, onOutcome } = await ringing({ isCallElsewhere });
        expect(result.current.phase).toBe('idle');
        expect(isCallElsewhere).toHaveBeenCalledTimes(1);
        expect(isCallElsewhere).toHaveBeenCalledWith(10);
        expect(log).toHaveBeenCalledWith('call_skip', {
            service: 'hinatazaka46', group_id: 34, member_id: 58, message_id: 10, reason: 'popup_active',
        });
        expect(onOutcome).toHaveBeenCalledWith({ kind: 'skipped', reason: 'popup_active' });
        expect(events()).not.toContain('call_ring');
    });

    it('rings when the popup does not own the voice', async () => {
        const { result } = await ringing({ isCallElsewhere: vi.fn(() => Promise.resolve(false)) });
        expect(result.current.phase).toBe('ringing');
    });

    it('rings when the check rejects', async () => {
        const { result } = await ringing({ isCallElsewhere: vi.fn(() => Promise.reject(new Error('down'))) });
        expect(result.current.phase).toBe('ringing');
    });

    it('is asked after the preload resolved', async () => {
        const order: string[] = [];
        const preload = vi.fn(() => { order.push('preload-start'); return Promise.resolve().then(() => { order.push('preload-done'); }); });
        const isCallElsewhere = vi.fn(() => { order.push('elsewhere'); return Promise.resolve(false); });
        await ringing({ isCallElsewhere }, preload);
        expect(order).toEqual(['preload-start', 'preload-done', 'elsewhere']);
    });

    it('skips as superseded when the visit changes while the check is pending', async () => {
        let resolve!: (v: boolean) => void;
        const isCallElsewhere = vi.fn(() => new Promise<boolean>(r => { resolve = r; }));
        const { result, rerender, onOutcome } = await ringing({ isCallElsewhere });
        expect(result.current.phase).toBe('idle');
        rerender({ a: makeArgs({ onOutcome, isCallElsewhere, chatDir: 'other', freshFetch: null, isGroupChat: true }) });
        await act(async () => { resolve(false); await Promise.resolve(); await Promise.resolve(); });
        expect(result.current.phase).toBe('idle');
        expect(log).toHaveBeenCalledWith('call_skip', expect.objectContaining({ message_id: 10, reason: 'superseded' }));
        expect(onOutcome).toHaveBeenCalledWith({ kind: 'skipped', reason: 'superseded' });
        expect(events()).not.toContain('call_ring');
    });
});
