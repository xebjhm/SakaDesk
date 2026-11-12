import { describe, it, expect } from 'vitest';
import { POSTER_MAX_NUMBERS, formatFullDay, posterFilename, posterNumbers, posterSince, posterYears } from './posterCopy';
import { posterData } from './__fixtures__/payload';
import type { RecapPoster } from './api';

describe('posterNumbers', () => {
    it('keeps at most three numbers, in the payload order', () => {
        const poster = posterData({
            numbers: [
                { key: 'nickname', count: 42 }, { key: 'oyasumi', count: 180 }, { key: 'photos', count: 96 },
                { key: 'voice', count: 30 }, { key: 'daisuki', count: 12 },
            ],
        });
        const lines = posterNumbers(poster);
        expect(POSTER_MAX_NUMBERS).toBe(3);
        expect(lines).toHaveLength(3);
        expect(lines.map((l) => l.key)).toEqual([
            'recap.poster.numbers.nickname', 'recap.poster.numbers.oyasumi', 'recap.poster.numbers.photos',
        ]);
        expect(lines[1].params).toEqual({ count: 180 });
    });

    it('never shows a zero or an unknown key', () => {
        const numbers = [
            { key: 'nickname', count: 0 }, { key: 'total', count: 9000 }, { key: 'voice', count: 8 },
        ] as unknown as RecapPoster['numbers'];
        expect(posterNumbers(posterData({ numbers })).map((l) => l.key)).toEqual(['recap.poster.numbers.voice']);
    });
});

describe('posterYears', () => {
    it('appears only from the second year', () => {
        expect(posterYears(null)).toBeNull();
        expect(posterYears(1)).toBeNull();
        expect(posterYears(2)).toEqual({ key: 'recap.poster.years', params: { count: 2 } });
    });
});

describe('posterSince', () => {
    it('formats the subscription day with its year, or nothing', () => {
        expect(posterSince('2024-07-24', 'ja')).toEqual({ key: 'recap.poster.since', params: { date: '2024年7月24日' } });
        expect(posterSince(null, 'ja')).toBeNull();
        expect(posterSince('soon', 'ja')).toBeNull();
        expect(formatFullDay('2024-07-24', 'en')).toBe('July 24, 2024');
    });
});

describe('posterFilename', () => {
    it('names the file by year and member id only (no names)', () => {
        expect(posterFilename(2026, '58')).toBe('sakadesk-recap-2026-58.png');
        expect(posterFilename(2026, '金村')).toBe('sakadesk-recap-2026.png');
    });
});
