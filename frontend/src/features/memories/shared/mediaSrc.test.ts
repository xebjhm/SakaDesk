import { describe, it, expect } from 'vitest';
import { memoryMessage } from '../__fixtures__/memories';
import { buildMediaUrl } from '../../messages/mediaUrl';
import { memoryMediaSrc } from './mediaSrc';

describe('memoryMediaSrc', () => {
    it('uses media_url, else builds from media_file, else null', () => {
        expect(memoryMediaSrc(memoryMessage({ media_url: '/api/x.jpg', media_file: 'a/b.jpg' }))).toBe('/api/x.jpg');
        expect(memoryMediaSrc(memoryMessage({ media_file: 'a/b.jpg' }))).toBe(buildMediaUrl('hinatazaka46', 'a/b.jpg'));
        expect(memoryMediaSrc(memoryMessage())).toBeNull();
    });
});
