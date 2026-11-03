import { describe, it, expect, vi, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../__tests__/mocks/server';
import { clientLog } from './clientLog';

afterEach(() => vi.restoreAllMocks());

describe('clientLog', () => {
    it('posts the event and fields as JSON', async () => {
        let received: unknown = null;
        server.use(
            http.post('/api/client-log', async ({ request }) => {
                received = await request.json();
                return new HttpResponse(null, { status: 204 });
            }),
        );
        clientLog('call_ring', { service: 'hinatazaka46', message_id: 7 });
        await vi.waitFor(() => expect(received).not.toBeNull());
        expect(received).toEqual({ event: 'call_ring', fields: { service: 'hinatazaka46', message_id: 7 } });
    });

    it('never throws when the server rejects', async () => {
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
        server.use(http.post('/api/client-log', () => new HttpResponse(null, { status: 422 })));
        expect(() => clientLog('call_skip', { reason: 'disabled' })).not.toThrow();
        await vi.waitFor(() => expect(debug).toHaveBeenCalled());
    });

    it('never throws when the network fails', async () => {
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
        server.use(http.post('/api/client-log', () => HttpResponse.error()));
        expect(() => clientLog('call_timeout', { message_id: 1 })).not.toThrow();
        await vi.waitFor(() => expect(debug).toHaveBeenCalled());
    });
});
