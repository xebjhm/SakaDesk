import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import { memberImageUrl, periodLabel, fetchProfileImages, PROFILE_IMAGE_KINDS } from './profileImages';

describe('memberImageUrl', () => {
    it('prefers the local archive, falls back to the CDN', () => {
        expect(memberImageUrl({ thumbnail: 'cdn', thumbnail_local: '/local' }, 'thumbnail')).toBe('/local');
        expect(memberImageUrl({ thumbnail: 'cdn', thumbnail_local: null }, 'thumbnail')).toBe('cdn');
        expect(memberImageUrl(undefined, 'phone_image')).toBeUndefined();
    });
});

describe('periodLabel', () => {
    const entries = [
        { url: 'c', first_seen: '2026-07-05T00:00:00Z', current: true },
        { url: 'b', first_seen: '2026-03-14T00:00:00Z', current: false },
        { url: 'a', first_seen: null, current: false },
    ];
    it('labels current as "<from> – <now>" and older ones by the next newer start', () => {
        expect(periodLabel(entries, 0, '目前')).toMatch(/^2026\/07\/0[45] – 目前$/);
        expect(periodLabel(entries, 1, '目前')).toMatch(/^2026\/03\/1[34] – 2026\/07\/0[45]$/);
    });
    it('uses the current label alone when the start is unknown', () => {
        expect(periodLabel([{ url: 'x', first_seen: null, current: true }], 0, 'Now')).toBe('Now');
        expect(periodLabel(entries, 2, '目前')).toBe('');
    });
});

describe('fetchProfileImages', () => {
    it('returns the kinds map', async () => {
        server.use(http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: { thumbnail: [{ url: 'u', first_seen: null, current: true }] } })));
        const kinds = await fetchProfileImages('日向坂46/messages/34 a/58 b');
        expect(kinds.thumbnail?.[0].url).toBe('u');
    });
    it('returns an empty map when the body has no kinds', async () => {
        server.use(http.get('/api/content/profile_images', () => HttpResponse.json({})));
        expect(await fetchProfileImages('x')).toEqual({});
    });
    it('throws on HTTP errors', async () => {
        server.use(http.get('/api/content/profile_images', () => new HttpResponse(null, { status: 404 })));
        await expect(fetchProfileImages('x')).rejects.toThrow();
    });
    it('orders kinds list icon, chat icon, call screen', () => {
        expect(PROFILE_IMAGE_KINDS).toEqual(['group_thumbnail', 'thumbnail', 'phone_image']);
    });
});
