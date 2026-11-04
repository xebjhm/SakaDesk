import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import {
    fetchAccountProfile, fetchLocalLetters, letterAvatars, letterImageHeight, pickLetterAvatar, LETTER_WIDTH, type Letter,
} from './letters';

const PATH = '日向坂46/messages/90 高井 俐香/142 高井 俐香';
const letter = (id: number, created_at: string): Letter => ({ id, text: 'ありがとう🌸', created_at, image_url: null, width: 341, height: 512 });
const avatars = [
    { url: '/a.jpg', first_seen: '2024-01-01T00:00:00Z' },
    { url: '/b.jpg', first_seen: '2025-06-01T00:00:00Z' },
];

describe('pickLetterAvatar', () => {
    it('takes the newest avatar first seen at or before the send time', () => {
        expect(pickLetterAvatar(avatars, '2025-07-01T00:00:00Z')).toEqual({ url: '/b.jpg', source: 'history' });
        expect(pickLetterAvatar(avatars, '2025-06-01T00:00:00Z')).toEqual({ url: '/b.jpg', source: 'history' });
        expect(pickLetterAvatar(avatars, '2025-05-31T23:59:59Z')).toEqual({ url: '/a.jpg', source: 'history' });
    });

    it('falls back to the earliest known avatar, whatever the order', () => {
        expect(pickLetterAvatar([...avatars].reverse(), '2023-01-01T00:00:00Z')).toEqual({ url: '/a.jpg', source: 'fallback' });
    });

    it('has none without avatars', () => {
        expect(pickLetterAvatar([], '2025-01-01T00:00:00Z')).toEqual({ url: null, source: 'none' });
    });
});

describe('letterAvatars', () => {
    it('maps every letter and counts the sources', () => {
        const out = letterAvatars([letter(1, '2023-01-01T00:00:00Z'), letter(2, '2025-07-01T00:00:00Z')], avatars);
        expect(out.byId.get(1)).toBe('/a.jpg');
        expect(out.byId.get(2)).toBe('/b.jpg');
        expect([out.history, out.fallback]).toEqual([1, 1]);
    });
});

describe('letterImageHeight', () => {
    it('reserves the height for a LETTER_WIDTH-wide image', () => {
        expect(LETTER_WIDTH).toBe(180);
        expect(letterImageHeight({ width: 341, height: 512 })).toBe(270);
        expect(letterImageHeight({ width: null, height: null })).toBe(240);
    });
});

describe('fetchers', () => {
    it('fetchLocalLetters sends the service and the member path', async () => {
        const seen: { params?: URLSearchParams } = {};
        server.use(http.get('/api/chat/letters_local', ({ request }) => {
            seen.params = new URL(request.url).searchParams;
            return HttpResponse.json({ letters: [letter(1, '2025-01-01T00:00:00Z')] });
        }));
        await expect(fetchLocalLetters('hinatazaka46', PATH)).resolves.toEqual([letter(1, '2025-01-01T00:00:00Z')]);
        expect(seen.params?.get('service')).toBe('hinatazaka46');
        expect(seen.params?.get('path')).toBe(PATH);
    });

    it('fetchLocalLetters rejects on an error status', async () => {
        server.use(http.get('/api/chat/letters_local', () => HttpResponse.json({}, { status: 403 })));
        await expect(fetchLocalLetters('hinatazaka46', '../x')).rejects.toThrow();
    });

    it('fetchAccountProfile returns the name and avatars', async () => {
        server.use(http.get('/api/account/profile', () => HttpResponse.json({ name: 'ゆき', avatars })));
        await expect(fetchAccountProfile('hinatazaka46')).resolves.toEqual({ name: 'ゆき', avatars });
    });
});
