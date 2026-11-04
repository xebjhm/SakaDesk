import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import { useRoomLetters } from './useRoomLetters';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';

const L = { id: 1, text: '🌸', created_at: '2025-01-01T00:00:00Z', image_url: null, width: null, height: null };
const PROFILE = { name: 'ゆき', avatars: [] };

beforeEach(() => vi.mocked(clientLog).mockClear());

describe('useRoomLetters', () => {
    it('a group chat has no letters and is ready at once, without a letters request', async () => {
        let asked = false;
        server.use(
            http.get('/api/chat/letters_local', () => { asked = true; return HttpResponse.json({ letters: [L] }); }),
            http.get('/api/account/profile', () => HttpResponse.json(PROFILE)),
        );
        const { result } = renderHook(() => useRoomLetters('hinatazaka46', 'group/a', true, 0));
        expect(result.current.ready).toBe(true);
        expect(result.current.letters).toEqual([]);
        expect(clientLog).toHaveBeenCalledWith('letters_load', { outcome: 'skipped_group' });
        await waitFor(() => expect(result.current.profile).toEqual(PROFILE));
        expect(asked).toBe(false);
    });

    it('loads a 1:1 room, then is ready; a revisit is ready at once from the cache', async () => {
        server.use(
            http.get('/api/chat/letters_local', () => HttpResponse.json({ letters: [L] })),
            http.get('/api/account/profile', () => HttpResponse.json(PROFILE)),
        );
        const first = renderHook(() => useRoomLetters('hinatazaka46', 'room/b', false, 0));
        expect(first.result.current.ready).toBe(false);
        await waitFor(() => expect(first.result.current.ready).toBe(true));
        expect(first.result.current.letters).toEqual([L]);
        expect(clientLog).toHaveBeenCalledWith('letters_load', { outcome: 'ok', count: 1 });
        first.unmount();
        const again = renderHook(() => useRoomLetters('hinatazaka46', 'room/b', false, 0));
        expect(again.result.current.ready).toBe(true);
        expect(again.result.current.letters).toEqual([L]);
    });

    it('a failed request logs and leaves the room ready without letters', async () => {
        server.use(
            http.get('/api/chat/letters_local', () => HttpResponse.json({}, { status: 500 })),
            http.get('/api/account/profile', () => HttpResponse.json({}, { status: 500 })),
        );
        const { result } = renderHook(() => useRoomLetters('hinatazaka46', 'room/c', false, 0));
        await waitFor(() => expect(result.current.ready).toBe(true));
        expect(result.current.letters).toEqual([]);
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('account_profile_load', { outcome: 'error' }));
        expect(clientLog).toHaveBeenCalledWith('letters_load', { outcome: 'error' });
        expect(result.current.profile).toBeNull();
    });

    it('never holds the messages back: a hanging request times out to no letters', async () => {
        server.use(
            http.get('/api/chat/letters_local', async () => { await delay('infinite'); return HttpResponse.json({ letters: [] }); }),
            http.get('/api/account/profile', () => HttpResponse.json(PROFILE)),
        );
        const { result } = renderHook(() => useRoomLetters('hinatazaka46', 'room/d', false, 0, 20));
        expect(result.current.ready).toBe(false);
        await waitFor(() => expect(result.current.ready).toBe(true));
        expect(result.current.letters).toEqual([]);
        expect(clientLog).toHaveBeenCalledWith('letters_load', { outcome: 'timeout' });
    });
});
