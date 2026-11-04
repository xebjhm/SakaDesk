import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));

import { clientLog } from '../utils/clientLog';
import { persisted } from '../core/persistence/persisted';
import * as appStateApi from '../core/persistence/appStateApi';
import { markVoiceHeard } from './markVoiceHeard';

const PATH = '日向坂46/messages/34 金村 美玖/58 金村 美玖';

describe('markVoiceHeard', () => {
    let row: Record<string, unknown>;
    let setConv: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        row = {};
        vi.mocked(clientLog).mockClear();
        vi.spyOn(persisted, 'conversationsReady').mockReturnValue(true);
        vi.spyOn(persisted, 'getConv').mockImplementation(((k: string, fb: unknown) => row[k] ?? fb) as never);
        setConv = vi.spyOn(persisted, 'setConv').mockImplementation(((k: string, v: unknown) => { row[k] = v; }) as never);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('applies a valid payload, then reports no change the second time', () => {
        const payload = { service: 'hinatazaka46', path: PATH, message_id: 10 };
        expect(markVoiceHeard(payload)).toBe(true);
        expect(clientLog).toHaveBeenLastCalledWith('call_popup_heard_applied', {
            service: 'hinatazaka46', group_id: 34, member_id: 58, message_id: 10, changed: true,
        });
        expect(setConv).toHaveBeenCalledTimes(1);
        expect(markVoiceHeard(payload)).toBe(true);
        expect(clientLog).toHaveBeenLastCalledWith('call_popup_heard_applied', {
            service: 'hinatazaka46', group_id: 34, member_id: 58, message_id: 10, changed: false,
        });
        expect(setConv).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['null', null],
        ['missing path', { service: 'hinatazaka46', message_id: 10 }],
        ['string id', { service: 'hinatazaka46', path: PATH, message_id: '10' }],
        ['fractional id', { service: 'hinatazaka46', path: PATH, message_id: 1.5 }],
        ['zero id', { service: 'hinatazaka46', path: PATH, message_id: 0 }],
        ['missing service', { path: PATH, message_id: 10 }],
        ['service not matching the path', { service: 'sakurazaka46', path: PATH, message_id: 10 }],
        ['unparsable path', { service: 'hinatazaka46', path: 'x/y', message_id: 10 }],
    ])('ignores a malformed payload (%s)', (_n, payload) => {
        expect(markVoiceHeard(payload)).toBe(true);
        expect(clientLog).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('call_popup_heard_ignored', { reason: 'malformed' });
        expect(setConv).not.toHaveBeenCalled();
    });

    it('applies a heard request over a malformed stored row (JSON null)', () => {
        row[`read_state_${PATH}`] = { value: 'null' };
        expect(markVoiceHeard({ service: 'hinatazaka46', path: PATH, message_id: 10 })).toBe(true);
        expect(clientLog).toHaveBeenLastCalledWith('call_popup_heard_applied', expect.objectContaining({ changed: true }));
    });

    it('catches any failure, logs reason=error and still returns true (final, no retry)', () => {
        vi.spyOn(persisted, 'getConv').mockImplementation((() => { throw new Error('boom 金村'); }) as never);
        expect(markVoiceHeard({ service: 'hinatazaka46', path: PATH, message_id: 10 })).toBe(true);
        expect(clientLog).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('call_popup_heard_ignored', { reason: 'error' });
        expect(JSON.stringify(vi.mocked(clientLog).mock.calls)).not.toMatch(/金村|boom/);
    });

    it('returns null (not_ready) and leaves the row untouched until the cache has loaded', () => {
        vi.mocked(persisted.conversationsReady).mockReturnValue(false);
        const key = `read_state_${PATH}`;
        row[key] = { value: JSON.stringify({ lastReadId: 99, readCount: 5, revealedIds: [] }) };
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockClear();
        expect(markVoiceHeard({ service: 'hinatazaka46', path: PATH, message_id: 10 })).toBeNull();
        expect(clientLog).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('call_popup_heard_ignored', { reason: 'not_ready' });
        expect(setConv).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled(); // no search-copy PUT either
        expect(row[key]).toEqual({ value: JSON.stringify({ lastReadId: 99, readCount: 5, revealedIds: [] }) });
    });

    it('stays not_ready after a failed cache load, and applies once a load succeeds', async () => {
        vi.mocked(persisted.conversationsReady).mockRestore();
        const load = vi.spyOn(appStateApi, 'getAllConversations').mockRejectedValueOnce(new Error('down'));
        await persisted.hydrateConversations();
        const payload = { service: 'hinatazaka46', path: PATH, message_id: 10 };
        expect(markVoiceHeard(payload)).toBeNull();
        expect(clientLog).toHaveBeenLastCalledWith('call_popup_heard_ignored', { reason: 'not_ready' });
        expect(setConv).not.toHaveBeenCalled();

        load.mockResolvedValueOnce({});
        await persisted.hydrateConversations();
        expect(markVoiceHeard(payload)).toBe(true);
        expect(clientLog).toHaveBeenLastCalledWith('call_popup_heard_applied', expect.objectContaining({ changed: true }));
        expect(setConv).toHaveBeenCalledTimes(1);
    });

    it('never logs the path or a name', () => {
        markVoiceHeard({ service: 'hinatazaka46', path: PATH, message_id: 10 });
        markVoiceHeard(null);
        expect(JSON.stringify(vi.mocked(clientLog).mock.calls)).not.toMatch(/金村|messages/);
    });
});
