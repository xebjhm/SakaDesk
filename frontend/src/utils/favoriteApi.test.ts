import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../__tests__/mocks/server';
import { setFavorite } from './favoriteApi';

describe('setFavorite', () => {
    it('POSTs to set and DELETEs to clear, with the service in the query', async () => {
        const seen: string[] = [];
        server.use(
            http.post('/api/favorites/:id', ({ request, params }) => {
                seen.push(`POST ${params.id} ${new URL(request.url).searchParams.get('service')}`);
                return HttpResponse.json({ success: true, message_id: 7, is_favorite: true });
            }),
            http.delete('/api/favorites/:id', ({ request, params }) => {
                seen.push(`DELETE ${params.id} ${new URL(request.url).searchParams.get('service')}`);
                return HttpResponse.json({ success: true, message_id: 7, is_favorite: false });
            }),
        );
        await expect(setFavorite('日向坂46', 7, true)).resolves.toBe(true);
        await expect(setFavorite('日向坂46', 7, false)).resolves.toBe(true);
        expect(seen).toEqual(['POST 7 日向坂46', 'DELETE 7 日向坂46']);
    });

    it('resolves false on an HTTP error', async () => {
        server.use(http.post('/api/favorites/:id', () => HttpResponse.json({ detail: 'x' }, { status: 500 })));
        await expect(setFavorite('hinatazaka46', 7, true)).resolves.toBe(false);
    });

    it('resolves false on a 200 with success: false (SD-CONTRACT-01)', async () => {
        server.use(http.delete('/api/favorites/:id', () => HttpResponse.json({ success: false, error: 'expired' })));
        await expect(setFavorite('hinatazaka46', 7, false)).resolves.toBe(false);
    });

    it('resolves true on a 200 without a readable body', async () => {
        server.use(http.post('/api/favorites/:id', () => new HttpResponse('not json', { status: 200 })));
        await expect(setFavorite('hinatazaka46', 7, true)).resolves.toBe(true);
    });

    it('resolves false when the network fails', async () => {
        server.use(http.post('/api/favorites/:id', () => HttpResponse.error()));
        await expect(setFavorite('hinatazaka46', 7, true)).resolves.toBe(false);
    });

    it("rejects with the fetch's AbortError when the caller aborts", async () => {
        server.use(http.post('/api/favorites/:id', () => new Promise<Response>(() => {})));
        const controller = new AbortController();
        const done = setFavorite('hinatazaka46', 7, true, controller.signal);
        controller.abort();
        await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    });
});
