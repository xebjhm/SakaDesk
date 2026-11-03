import { describe, it, expect } from 'vitest';
import { buildMediaUrl } from './mediaUrl';

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
