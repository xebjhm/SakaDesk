import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../__tests__/mocks/server';
import { clientLog } from '../../utils/clientLog';
import { isCallPopupActive } from './callPopupApi';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
const log = vi.mocked(clientLog);
const breadcrumb = ['call_error', { message_id: 10, phase: 'idle', error_type: 'popup_check_failed' }];

beforeEach(() => { log.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); });

const ctx = { service: 'hinatazaka46', groupId: 34, memberId: 58 };

describe('isCallPopupActive', () => {
    it('requests the active endpoint with the chat and message ids and returns true for {active: true}', async () => {
        let url = '';
        server.use(http.get('/api/call-popup/active', ({ request }) => {
            url = new URL(request.url).pathname + new URL(request.url).search;
            return HttpResponse.json({ active: true });
        }));
        expect(await isCallPopupActive(ctx, 10)).toBe(true);
        expect(url).toBe('/api/call-popup/active?service=hinatazaka46&group_id=34&member_id=58&message_id=10');
        expect(log).not.toHaveBeenCalled();
    });

    it('returns false for {active: false}', async () => {
        server.use(http.get('/api/call-popup/active', () => HttpResponse.json({ active: false })));
        expect(await isCallPopupActive(ctx, 10)).toBe(false);
        expect(log).not.toHaveBeenCalled();
    });

    it('returns false on a 500', async () => {
        server.use(http.get('/api/call-popup/active', () => new HttpResponse(null, { status: 500 })));
        expect(await isCallPopupActive(ctx, 10)).toBe(false);
        expect(log.mock.calls).toEqual([breadcrumb]);
    });

    it('returns false on a network error', async () => {
        server.use(http.get('/api/call-popup/active', () => HttpResponse.error()));
        expect(await isCallPopupActive(ctx, 10)).toBe(false);
        expect(log.mock.calls).toEqual([breadcrumb]);
    });

    it('returns false and logs once on a malformed body', async () => {
        server.use(http.get('/api/call-popup/active', () => new HttpResponse('not json', { status: 200 })));
        expect(await isCallPopupActive(ctx, 10)).toBe(false);
        expect(log.mock.calls).toEqual([breadcrumb]);
    });

    it('passes a timeout signal to fetch', async () => {
        const spy = vi.spyOn(globalThis, 'fetch');
        await isCallPopupActive(ctx, 10);
        expect(spy.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    });

    it('returns false and logs once when the request times out', async () => {
        server.use(http.get('/api/call-popup/active', async () => {
            await delay('infinite');
            return HttpResponse.json({ active: true });
        }));
        if (typeof AbortSignal.timeout === 'function') {
            vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.timeout(20));
        }
        expect(await isCallPopupActive(ctx, 10)).toBe(false);
        expect(log.mock.calls).toEqual([breadcrumb]);
    });

    it('returns false and logs once when fetch throws synchronously', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('sync'); });
        expect(await isCallPopupActive(ctx, 10)).toBe(false);
        expect(log.mock.calls).toEqual([breadcrumb]);
    });
});
