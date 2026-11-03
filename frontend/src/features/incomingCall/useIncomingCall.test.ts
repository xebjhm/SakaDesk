import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MemberInfo, Message } from '../../types';
import { clientLog } from '../../utils/clientLog';
import {
    useIncomingCall, ENDED_HOLD_MS, RING_TIMEOUT_MS, type UseIncomingCallArgs,
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
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => { vi.useFakeTimers(); log.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

async function ringing(over: Partial<UseIncomingCallArgs> = {}, preload = vi.fn(() => Promise.resolve())) {
    const hook = renderHook(({ a }) => useIncomingCall(a, preload), { initialProps: { a: makeArgs(over) } });
    await flush();
    return { ...hook, preload };
}

describe('useIncomingCall', () => {
    it('rings after a fresh fetch and preloads the audio URL', async () => {
        const { result, preload } = await ringing();
        expect(preload).toHaveBeenCalledWith(expect.stringContaining('/api/content/media/hinatazaka46/messages/'));
        expect(result.current.phase).toBe('ringing');
        expect(result.current.message?.id).toBe(10);
        expect(result.current.photoUrl).toBe('/img/phone.jpg');
        expect(log).toHaveBeenCalledWith('call_ring', { service: 'hinatazaka46', group_id: 34, member_id: 58, message_id: 10 });
    });

    it('does not ring without a fresh fetch for this chat (cached render)', async () => {
        const { result } = await ringing({ freshFetch: null });
        expect(result.current.phase).toBe('idle');
        const other = await ringing({ freshFetch: { seq: 1, dir: 'other/dir' } });
        expect(other.result.current.phase).toBe('idle');
    });

    it('does not ring while settings are not loaded', async () => {
        const { result } = await ringing({ enabled: undefined });
        expect(result.current.phase).toBe('idle');
        expect(log).toHaveBeenCalledWith('call_skip', expect.objectContaining({ reason: 'disabled' }));
    });

    it('logs media_unavailable once per visit when preload fails, and does not ring', async () => {
        const failing = vi.fn(() => Promise.reject(new Error('media_unavailable')));
        const { result, rerender } = await ringing({}, failing);
        expect(result.current.phase).toBe('idle');
        rerender({ a: makeArgs({ freshFetch: { seq: 2, dir: DIR } }) });
        await flush();
        const errors = log.mock.calls.filter(c => c[0] === 'call_error');
        expect(errors).toHaveLength(1);
        expect(errors[0][1]).toMatchObject({ message_id: 10, error_type: 'media_unavailable', phase: 'idle' });
    });

    it('decline keeps the voice unread and suppresses re-ring for this visit only', async () => {
        const { result, rerender } = await ringing();
        act(() => result.current.decline());
        expect(result.current.phase).toBe('idle');
        expect(events()).toContain('call_decline');
        rerender({ a: makeArgs({ freshFetch: { seq: 2, dir: DIR } }) });
        await flush();
        expect(result.current.phase).toBe('idle');
        expect(log).toHaveBeenCalledWith('call_skip', expect.objectContaining({ reason: 'dismissed_this_visit' }));
        // leave and come back → new visit → rings again
        rerender({ a: makeArgs({ chatDir: 'other', freshFetch: { seq: 3, dir: 'other' }, isGroupChat: true }) });
        await flush();
        rerender({ a: makeArgs({ freshFetch: { seq: 4, dir: DIR } }) });
        await flush();
        expect(result.current.phase).toBe('ringing');
    });

    it('a newer voice during the visit rings even after a decline', async () => {
        const { result, rerender } = await ringing();
        act(() => result.current.decline());
        rerender({ a: makeArgs({ messages: [voice(10, '2026-11-01T10:00:00Z'), voice(11, '2026-11-01T11:00:00Z')], freshFetch: { seq: 2, dir: DIR } }) });
        await flush();
        expect(result.current.phase).toBe('ringing');
        expect(result.current.message?.id).toBe(11);
    });

    it('times out after 30 s like a decline', async () => {
        const { result } = await ringing();
        act(() => { vi.advanceTimersByTime(RING_TIMEOUT_MS); });
        expect(result.current.phase).toBe('idle');
        expect(log).toHaveBeenCalledWith('call_timeout', { message_id: 10 });
    });

    it('answer reveals, plays to the end, holds the ended screen, then scrolls', async () => {
        const revealMessage = vi.fn();
        const scrollToMessage = vi.fn();
        const { result } = await ringing({ revealMessage, scrollToMessage });
        act(() => result.current.answer());
        expect(revealMessage).toHaveBeenCalledWith(10);
        expect(result.current.phase).toBe('connected');
        expect(result.current.talkStartedAt).not.toBeNull();
        expect(log).toHaveBeenCalledWith('call_answer', expect.objectContaining({ message_id: 10 }));
        act(() => result.current.onPlaybackEnded());
        expect(result.current.phase).toBe('ended');
        expect(log).toHaveBeenCalledWith('call_end', expect.objectContaining({ message_id: 10, reason: 'played' }));
        expect(scrollToMessage).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(ENDED_HOLD_MS); });
        expect(result.current.phase).toBe('idle');
        expect(scrollToMessage).toHaveBeenCalledWith(10);
    });

    it('hang up ends the call with reason hung_up', async () => {
        const { result } = await ringing();
        act(() => result.current.answer());
        act(() => result.current.hangUp());
        expect(result.current.phase).toBe('ended');
        expect(log).toHaveBeenCalledWith('call_end', expect.objectContaining({ reason: 'hung_up' }));
    });

    it('playback error logs call_error and goes to ended', async () => {
        const { result } = await ringing();
        act(() => result.current.answer());
        act(() => result.current.onPlaybackError());
        expect(result.current.phase).toBe('ended');
        expect(log).toHaveBeenCalledWith('call_error', expect.objectContaining({ error_type: 'playback_failed', phase: 'connected' }));
    });

    it.each(['ringing', 'connected'] as const)('switching chat while %s cancels without scrolling', async (phase) => {
        const scrollToMessage = vi.fn();
        const { result, rerender } = await ringing({ scrollToMessage });
        if (phase === 'connected') act(() => result.current.answer());
        rerender({ a: makeArgs({ chatDir: 'other', freshFetch: null, scrollToMessage }) });
        await flush();
        expect(result.current.phase).toBe('idle');
        expect(log).toHaveBeenCalledWith('call_cancel', { message_id: 10, phase });
        act(() => { vi.advanceTimersByTime(ENDED_HOLD_MS + RING_TIMEOUT_MS); });
        expect(scrollToMessage).not.toHaveBeenCalled();
    });

    it('does not ring if the voice was read while the preload was in flight', async () => {
        let release!: () => void;
        const slow = vi.fn(() => new Promise<void>(r => { release = r; }));
        let unread = true;
        const { result } = renderHook(({ a }) => useIncomingCall(a, slow), {
            initialProps: { a: makeArgs({ isUnread: () => unread }) },
        });
        unread = false;
        await act(async () => { release(); await Promise.resolve(); });
        expect(result.current.phase).toBe('idle');
        expect(events()).not.toContain('call_ring');
        expect(log).toHaveBeenCalledWith('call_skip', {
            service: 'hinatazaka46', group_id: 34, member_id: 58, message_id: 10, reason: 'already_read',
        });
    });

    it('a newer evaluation supersedes an in-flight preload and the skip is logged', async () => {
        const releases: Array<() => void> = [];
        const slow = vi.fn(() => new Promise<void>(r => { releases.push(r); }));
        const { result, rerender } = renderHook(({ a }) => useIncomingCall(a, slow), { initialProps: { a: makeArgs() } });
        rerender({ a: makeArgs({ freshFetch: { seq: 2, dir: DIR } }) });
        expect(releases).toHaveLength(2);
        await act(async () => { releases[0](); await Promise.resolve(); await Promise.resolve(); });
        expect(result.current.phase).toBe('idle');
        expect(events()).not.toContain('call_ring');
        expect(log).toHaveBeenCalledWith('call_skip', {
            service: 'hinatazaka46', group_id: 34, member_id: 58, message_id: 10, reason: 'superseded',
        });
        await act(async () => { releases[1](); await Promise.resolve(); await Promise.resolve(); });
        expect(result.current.phase).toBe('ringing');
        expect(events().filter(e => e === 'call_ring')).toHaveLength(1);
    });

    it('a visit change during an in-flight preload logs superseded with the original chat context', async () => {
        let release!: () => void;
        const slow = vi.fn(() => new Promise<void>(r => { release = r; }));
        const { result, rerender } = renderHook(({ a }) => useIncomingCall(a, slow), { initialProps: { a: makeArgs() } });
        rerender({
            a: makeArgs({
                chatDir: 'other', freshFetch: null,
                logContext: { service: 'sakurazaka46', groupId: 99, memberId: 77 },
            }),
        });
        await act(async () => { release(); await Promise.resolve(); await Promise.resolve(); });
        expect(result.current.phase).toBe('idle');
        expect(events()).not.toContain('call_ring');
        expect(log).toHaveBeenCalledWith('call_skip', {
            service: 'hinatazaka46', group_id: 34, member_id: 58, message_id: 10, reason: 'superseded',
        });
    });

    it('logs the same skip only once per chat', async () => {
        const { rerender } = await ringing({ isUnread: () => false });
        rerender({ a: makeArgs({ isUnread: () => false, freshFetch: { seq: 2, dir: DIR } }) });
        await flush();
        expect(log.mock.calls.filter(c => c[0] === 'call_skip')).toHaveLength(1);
    });

    it('resets the skip dedupe on each visit to a chat', async () => {
        const skips = () => log.mock.calls.filter(c => c[0] === 'call_skip' && c[1]?.reason === 'already_read');
        const { rerender } = await ringing({ isUnread: () => false });
        expect(skips()).toHaveLength(1);
        rerender({ a: makeArgs({ chatDir: 'other', freshFetch: null }) });
        await flush();
        rerender({ a: makeArgs({ isUnread: () => false, freshFetch: { seq: 2, dir: DIR } }) });
        await flush();
        expect(skips()).toHaveLength(2);
    });

    it('never logs names, text or URLs', async () => {
        const { result } = await ringing();
        act(() => result.current.answer());
        act(() => result.current.onPlaybackEnded());
        for (const [, fields] of log.mock.calls) {
            for (const v of Object.values(fields ?? {})) {
                if (typeof v === 'string') expect(v).toMatch(/^[a-z0-9_]{1,40}$/);
            }
        }
    });
});
