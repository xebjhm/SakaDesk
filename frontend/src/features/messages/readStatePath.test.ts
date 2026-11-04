import { describe, it, expect } from 'vitest';
import { parseReadStatePath, serviceOfPath } from './readStatePath';

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

describe('serviceOfPath', () => {
    it('maps the service folder (first segment) to its service id', () => {
        expect(serviceOfPath('日向坂46/messages/34 金村 美玖/58 金村 美玖')).toBe('hinatazaka46');
        expect(serviceOfPath('櫻坂46/messages/79 中川 智尋/134 中川 智尋')).toBe('sakurazaka46');
    });

    it('also takes the service id as the folder, like the backend (case-insensitive)', () => {
        expect(serviceOfPath('hinatazaka46/messages/1 Big Room/1 Big Room')).toBe('hinatazaka46');
        expect(serviceOfPath('Sakurazaka46/messages/1 x')).toBe('sakurazaka46');
    });

    it('is undefined for a path outside every service folder', () => {
        expect(serviceOfPath('individual/test_member_001')).toBeUndefined();
        expect(serviceOfPath('')).toBeUndefined();
        expect(serviceOfPath('日向坂/messages/1 x')).toBeUndefined();
    });
});
