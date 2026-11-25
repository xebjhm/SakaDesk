import { describe, it, expect } from 'vitest';
import { AVATAR_WIDTHS, avatarWidthFor, buildMediaUrl, chatPictureThumbWidth, resizedAvatarUrl } from './mediaUrl';

describe('buildMediaUrl', () => {
    it('encodes the service and each path segment, keeping slashes', () => {
        expect(buildMediaUrl('日向坂46', 'messages/34 金村 美玖/58 金村 美玖/voice/1.m4a')).toBe(
            '/api/content/media/%E6%97%A5%E5%90%91%E5%9D%8246/messages/34%20%E9%87%91%E6%9D%91%20%E7%BE%8E%E7%8E%96/58%20%E9%87%91%E6%9D%91%20%E7%BE%8E%E7%8E%96/voice/1.m4a',
        );
    });

    it('honours a custom api base', () => {
        expect(buildMediaUrl('s', 'a/b.m4a', '/x')).toBe('/x/s/a/b.m4a');
    });
});

describe('resizedAvatarUrl', () => {
    const local = '/api/content/media/hinatazaka46/messages/34%20%E9%87%91%E6%9D%91/profile_images/group_thumbnail/a.jpg';

    it('points a local archived avatar at the resize route with the width', () => {
        expect(resizedAvatarUrl(local, 192)).toBe(
            '/api/content/avatar/hinatazaka46/messages/34%20%E9%87%91%E6%9D%91/profile_images/group_thumbnail/a.jpg?w=192',
        );
    });

    it('appends the width to an existing query', () => {
        expect(resizedAvatarUrl('/api/content/media/s/a.jpg?v=2', 64)).toBe('/api/content/avatar/s/a.jpg?v=2&w=64');
    });

    it('leaves CDN and other URLs unchanged', () => {
        expect(resizedAvatarUrl('https://cdn.example/members/58.jpeg', 192)).toBe('https://cdn.example/members/58.jpeg');
        expect(resizedAvatarUrl('/api/blogs/member-thumbnail/s/1', 192)).toBe('/api/blogs/member-thumbnail/s/1');
    });

    it('gives undefined for no source', () => {
        expect(resizedAvatarUrl(null, 192)).toBeUndefined();
        expect(resizedAvatarUrl(undefined, 192)).toBeUndefined();
        expect(resizedAvatarUrl('', 192)).toBeUndefined();
    });
});

describe('avatarWidthFor', () => {
    it('mirrors the backend allow-list (avatar_resize.ALLOWED_WIDTHS)', () => {
        expect([...AVATAR_WIDTHS]).toEqual([64, 80, 96, 112, 128, 160, 192, 256]);
    });

    it.each([
        // member list tile, 64 CSS px
        [64, 1, 64], [64, 1.25, 80], [64, 1.5, 96], [64, 1.75, 112], [64, 2, 128], [64, 2.5, 160], [64, 3, 192],
        // chat message / header avatar, 40 CSS px (70 device px at 175 % → 80)
        [40, 1, 64], [40, 1.5, 64], [40, 1.75, 80], [40, 2, 80], [40, 3, 128],
        // gallery header avatar, 48 CSS px
        [48, 1.75, 96], [48, 2, 96],
    ])('%i CSS px at %f dppx → %i', (css, dpr, expected) => {
        expect(avatarWidthFor(css, dpr)).toBe(expected);
    });

    it('rounds up, never down (no upscaling by the browser)', () => {
        // 64 × 1.1 = 70.4 → 80, not 64
        expect(avatarWidthFor(64, 1.1)).toBe(80);
    });

    it('tolerates float noise in the device pixel ratio', () => {
        // 64 × 1.7500000001 must still pick 112, not jump to 128
        expect(avatarWidthFor(64, 1.7500000001)).toBe(112);
    });

    it('clamps to the largest width above the allow-list', () => {
        expect(avatarWidthFor(64, 5)).toBe(256);
    });

    it('treats a missing or invalid ratio as 1', () => {
        expect(avatarWidthFor(64, 0)).toBe(64);
        expect(avatarWidthFor(64, Number.NaN)).toBe(64);
    });
});

describe('thumbnailUrl / thumbWidthFor', () => {
    it('points a local archived picture at the thumbnail route with the width', async () => {
        const { thumbnailUrl } = await import('./mediaUrl');
        expect(thumbnailUrl('/api/content/media/hinatazaka46/messages/a%20b/picture/1.jpg', 320))
            .toBe('/api/content/thumb/hinatazaka46/messages/a%20b/picture/1.jpg?w=320');
        expect(thumbnailUrl('https://cdn.example/x.jpg', 320)).toBe('https://cdn.example/x.jpg');
        expect(thumbnailUrl(null, 320)).toBeUndefined();
    });

    it('appends the content version v when given, and leaves the url unchanged without it', async () => {
        const { thumbnailUrl } = await import('./mediaUrl');
        const u = '/api/content/media/hinatazaka46/messages/a%20b/picture/1.jpg';
        expect(thumbnailUrl(u, 320, 'a1b2c3d4e5f6'))
            .toBe('/api/content/thumb/hinatazaka46/messages/a%20b/picture/1.jpg?w=320&v=a1b2c3d4e5f6');
        expect(thumbnailUrl(u, 320)).toBe('/api/content/thumb/hinatazaka46/messages/a%20b/picture/1.jpg?w=320');
        expect(thumbnailUrl(u, 320, undefined)).toBe(thumbnailUrl(u, 320));
        expect(thumbnailUrl(u, 320, '')).toBe(thumbnailUrl(u, 320));
        expect(thumbnailUrl(`${u}?x=1`, 160, 'a1b2c3d4e5f6'))
            .toBe('/api/content/thumb/hinatazaka46/messages/a%20b/picture/1.jpg?x=1&w=160&v=a1b2c3d4e5f6');
        expect(thumbnailUrl('https://cdn.example/x.jpg', 320, 'a1b2c3d4e5f6')).toBe('https://cdn.example/x.jpg');
    });

    it('picks the smallest allowed width covering the drawn size', async () => {
        const { thumbWidthFor } = await import('./mediaUrl');
        expect(thumbWidthFor(96, 1)).toBe(160);
        expect(thumbWidthFor(160, 1.5)).toBe(320);
        expect(thumbWidthFor(200, 2)).toBe(480);
        expect(thumbWidthFor(100, Number.NaN)).toBe(160);
    });

    it('caps grid tiles at the pre-generated 480; ★ items and covers may use 640', async () => {
        const { thumbWidthFor, THUMB_WIDTHS, THUMB_PREGEN_WIDTH, THUMB_LARGE_WIDTH } = await import('./mediaUrl');
        expect(THUMB_WIDTHS).toEqual([160, 320, 480, 640]);
        expect([THUMB_PREGEN_WIDTH, THUMB_LARGE_WIDTH]).toEqual([480, 640]);
        expect(thumbWidthFor(250, 1.75)).toBe(480); // ~440 px
        expect(thumbWidthFor(250, 2)).toBe(480); // 500 px: capped, not 640
        expect(thumbWidthFor(900, 2)).toBe(480);
        expect(thumbWidthFor(250, 2, { large: true })).toBe(640);
        expect(thumbWidthFor(200, 2, { large: true })).toBe(480);
        expect(thumbWidthFor(900, 2, { large: true })).toBe(640);
        expect(thumbWidthFor(150, 2, { large: false })).toBe(320);
    });
});

describe('chatPictureThumbWidth', () => {
    it('uses the pre-generated 480 when it covers the bubble box at the screen density', () => {
        // 800×600 fits 320×240: the long side is 320 CSS px.
        expect(chatPictureThumbWidth(800, 600, 'p/1.jpg', 1)).toBe(480);
        expect(chatPictureThumbWidth(800, 600, 'p/1.jpg', 1.25)).toBe(480);
        expect(chatPictureThumbWidth(800, 600, 'p/1.jpg', 1.5)).toBe(480);
        // 600×800 fits 320×427: the long side is 427 CSS px.
        expect(chatPictureThumbWidth(600, 800, 'p/1.jpg', 1)).toBe(480);
    });

    it('keeps the original when the box needs more than 480 px (no 640, no upscale)', () => {
        expect(chatPictureThumbWidth(800, 600, 'p/1.jpg', 2)).toBeUndefined();
        expect(chatPictureThumbWidth(800, 600, 'p/1.jpg', 2.5)).toBeUndefined();
        expect(chatPictureThumbWidth(600, 800, 'p/1.jpg', 1.25)).toBeUndefined();
        expect(chatPictureThumbWidth(600, 800, 'p/1.jpg', 1.5)).toBeUndefined();
    });

    it('keeps the original when it is no larger than the thumbnail', () => {
        expect(chatPictureThumbWidth(400, 300, 'p/1.jpg', 1)).toBeUndefined();
        expect(chatPictureThumbWidth(480, 360, 'p/1.jpg', 1)).toBeUndefined();
    });

    it('keeps the original for GIFs and for pictures without dimensions', () => {
        expect(chatPictureThumbWidth(800, 600, 'p/1.GIF', 1)).toBeUndefined();
        expect(chatPictureThumbWidth(null, 600, 'p/1.jpg', 1)).toBeUndefined();
        expect(chatPictureThumbWidth(800, 600, null, 1)).toBeUndefined();
    });
});
