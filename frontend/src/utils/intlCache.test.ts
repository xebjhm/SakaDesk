import { describe, it, expect } from 'vitest';
import { dateTimeFormat } from './intlCache';

describe('dateTimeFormat', () => {
    it('returns one shared formatter per locale and options', () => {
        const a = dateTimeFormat('ja', { month: 'long', day: 'numeric' });
        expect(dateTimeFormat('ja', { month: 'long', day: 'numeric' })).toBe(a);
        expect(dateTimeFormat('en', { month: 'long', day: 'numeric' })).not.toBe(a);
        expect(a.format(new Date(2024, 0, 15))).toBe('1月15日');
    });

    it('throws on an invalid locale like the constructor', () => {
        expect(() => dateTimeFormat('not a locale!', {})).toThrow(RangeError);
    });
});
