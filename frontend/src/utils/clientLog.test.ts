import { describe, it, expect, vi, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../__tests__/mocks/server';
import { clientLog, breadcrumbCode } from './clientLog';

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

    it('aborts a POST that never gets an answer, silently', async () => {
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
        const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
        server.use(http.post('/api/client-log', () => new Promise<Response>(() => {})));
        expect(() => clientLog('call_timeout', { message_id: 1 })).not.toThrow();
        expect(timeout).toHaveBeenCalledWith(4000);
        await vi.waitFor(() => expect(debug).toHaveBeenCalledWith('[clientLog] failed', 'call_timeout', expect.anything()));
    });

    it('falls back to an AbortController timer without AbortSignal.timeout', async () => {
        vi.useFakeTimers();
        try {
            const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
            vi.stubGlobal('AbortSignal', Object.assign(function () {}, { abort: AbortSignal.abort }));
            server.use(http.post('/api/client-log', () => new Promise<Response>(() => {})));
            expect(() => clientLog('call_timeout', { message_id: 1 })).not.toThrow();
            await vi.advanceTimersByTimeAsync(4001);
            await vi.waitFor(() => expect(debug).toHaveBeenCalledWith('[clientLog] failed', 'call_timeout', expect.anything()));
        } finally {
            vi.unstubAllGlobals();
            vi.useRealTimers();
        }
    });
});

describe('breadcrumbCode', () => {
    it('lowercases an error class name', () => {
        expect(breadcrumbCode(new DOMException('x', 'NotAllowedError'))).toBe('notallowederror');
        expect(breadcrumbCode(new TypeError('x'))).toBe('typeerror');
    });

    it('replaces other characters with underscores and caps at 40', () => {
        const err = new Error('x');
        err.name = 'Weird Name-1';
        expect(breadcrumbCode(err)).toBe('weird_name_1');
        err.name = 'a'.repeat(60);
        expect(breadcrumbCode(err)).toMatch(/^[a-z0-9_]{1,40}$/);
    });

    it('is unknown for non-errors and empty names', () => {
        expect(breadcrumbCode('boom')).toBe('unknown');
        expect(breadcrumbCode(undefined)).toBe('unknown');
        const err = new Error('x');
        err.name = '';
        expect(breadcrumbCode(err)).toBe('unknown');
    });
});
