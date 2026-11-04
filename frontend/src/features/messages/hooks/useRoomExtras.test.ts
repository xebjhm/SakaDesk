import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import { useRoomExtras } from './useRoomExtras';
import { resetStreakCache } from './useMemberStreak';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));

const HINATA_ROOM = '日向坂46/messages/90 高井 俐香/142 高井 俐香';
const SAKURA_ROOM = '櫻坂46/messages/79 中川 智尋/134 中川 智尋';

/** Records every letters / streak request as `service|path` and `service|groupId`. */
function serveExtras() {
    const letters: string[] = [];
    const streaks: string[] = [];
    server.use(
        http.get('/api/chat/letters_local', ({ request }) => {
            const q = new URL(request.url).searchParams;
            letters.push(`${q.get('service')}|${q.get('path')}`);
            return HttpResponse.json({ letters: [] });
        }),
        http.get('/api/chat/streak/:id', ({ request, params }) => {
            streaks.push(`${new URL(request.url).searchParams.get('service')}|${params.id}`);
            return HttpResponse.json({ days: 3, is_active: true });
        }),
        http.get('/api/account/profile', () => HttpResponse.json({ name: null, avatars: [] })),
    );
    return { letters, streaks };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(() => resetStreakCache());

describe('useRoomExtras', () => {
    it('a group switch never pairs the new service with the old room path', async () => {
        const seen = serveExtras();
        const { result, rerender } = renderHook(
            ({ service, path }) => useRoomExtras(service, path, false, 0),
            { initialProps: { service: 'hinatazaka46' as string | null, path: HINATA_ROOM as string | undefined } },
        );
        await waitFor(() => expect(result.current.lettersReady).toBe(true));
        await waitFor(() => expect(result.current.streak.status).toBe('ready'));
        expect(seen.letters).toEqual([`hinatazaka46|${HINATA_ROOM}`]);
        expect(seen.streaks).toEqual(['hinatazaka46|90']);

        // The commit where the service changed but the path is still the old group's.
        rerender({ service: 'sakurazaka46', path: HINATA_ROOM });
        expect(result.current.lettersReady).toBe(false);
        expect(result.current.streak).toEqual({ status: 'idle' });
        await settle();
        expect(seen.letters).toEqual([`hinatazaka46|${HINATA_ROOM}`]);
        expect(seen.streaks).toEqual(['hinatazaka46|90']);

        rerender({ service: 'sakurazaka46', path: SAKURA_ROOM });
        await waitFor(() => expect(result.current.lettersReady).toBe(true));
        await waitFor(() => expect(seen.streaks).toEqual(['hinatazaka46|90', 'sakurazaka46|79']));
        expect(seen.letters).toEqual([`hinatazaka46|${HINATA_ROOM}`, `sakurazaka46|${SAKURA_ROOM}`]);
    });

    it('without an active service the room is not held back and nothing is asked', async () => {
        const seen = serveExtras();
        const { result } = renderHook(() => useRoomExtras(null, HINATA_ROOM, false, 0));
        expect(result.current.lettersReady).toBe(true);
        expect(result.current.lettersStatus).toBe('unavailable');
        await settle();
        expect(seen.letters).toEqual([]);
        expect(seen.streaks).toEqual([]);
    });

    it('a path outside every service folder has no letters and is not held back', async () => {
        const seen = serveExtras();
        const { result } = renderHook(() => useRoomExtras('hinatazaka46', 'individual/test_member_001', false, 0));
        expect(result.current.lettersReady).toBe(true);
        await settle();
        expect(seen.letters).toEqual([]);
        expect(seen.streaks).toEqual([]);
    });

    it('reports the overview status: loading, then ready', async () => {
        serveExtras();
        const { result } = renderHook(() => useRoomExtras('hinatazaka46', '日向坂46/messages/91 x/143 x', false, 0));
        expect(result.current.lettersStatus).toBe('loading');
        await waitFor(() => expect(result.current.lettersStatus).toBe('ready'));
    });
});
