import { describe, it, expect } from 'vitest';
import { buildMediaUrl, resizedAvatarUrl } from './mediaUrl';

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
