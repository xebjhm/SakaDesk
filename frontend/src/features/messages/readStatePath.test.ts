import { describe, it, expect } from 'vitest';
import { parseReadStatePath } from './readStatePath';

describe('parseReadStatePath', () => {
    it('parses a 1:1 path', () => {
        expect(parseReadStatePath('日向坂46/messages/34 金村 美玖/58 金村 美玖')).toEqual({
            service: 'hinatazaka46', groupId: 34, memberId: 58,
        });
    });

    it('parses a room path with memberId 0', () => {
        expect(parseReadStatePath('日向坂46/messages/43 日向坂46')).toEqual({
            service: 'hinatazaka46', groupId: 43, memberId: 0,
        });
    });

    it('returns null for an unknown service or a malformed path', () => {
        expect(parseReadStatePath('nope/messages/1 x/2 y')).toBeNull();
        expect(parseReadStatePath('日向坂46/blogs/1')).toBeNull();
    });
});
