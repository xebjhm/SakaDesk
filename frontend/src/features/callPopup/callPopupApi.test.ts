import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import { isCallPopupActive } from './callPopupApi';

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
    });

    it('returns false for {active: false}', async () => {
        server.use(http.get('/api/call-popup/active', () => HttpResponse.json({ active: false })));
        expect(await isCallPopupActive(ctx, 10)).toBe(false);
    });

    it('returns false on a 500', async () => {
        server.use(http.get('/api/call-popup/active', () => new HttpResponse(null, { status: 500 })));
        expect(await isCallPopupActive(ctx, 10)).toBe(false);
    });

    it('returns false on a network error', async () => {
        server.use(http.get('/api/call-popup/active', () => HttpResponse.error()));
        expect(await isCallPopupActive(ctx, 10)).toBe(false);
    });
});
