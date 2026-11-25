import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import { fetchMemberRecap, fetchRecapMembers } from './api';
import { MEMBER_PATH, overview, payload } from './__fixtures__/payload';

describe('recap api', () => {
    it('fetches the overview of a service and year', async () => {
        server.use(http.get('/api/memories/hinatazaka46/recap/2026/members', () => HttpResponse.json(overview())));
        const res = await fetchRecapMembers('hinatazaka46', 2026);
        expect(res.status).toBe('ok');
    });

    it('encodes the member path as a query parameter', async () => {
        let member: string | null = null;
        server.use(http.get('/api/memories/hinatazaka46/recap/2026', ({ request }) => {
            member = new URL(request.url).searchParams.get('member');
            return HttpResponse.json(payload());
        }));
        const res = await fetchMemberRecap('hinatazaka46', 2026, MEMBER_PATH);
        expect(res.status).toBe('ok');
        expect(member).toBe(MEMBER_PATH);
    });

    it('reports a rejected request as a value', async () => {
        server.use(http.get('/api/memories/hinatazaka46/recap/2026', () => HttpResponse.json({}, { status: 404 })));
        const res = await fetchMemberRecap('hinatazaka46', 2026, MEMBER_PATH);
        expect(res).toEqual({ status: 'rejected', httpStatus: 404 });
    });
});
