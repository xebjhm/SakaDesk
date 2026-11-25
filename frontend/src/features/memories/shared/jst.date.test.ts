import { describe, expect, it } from 'vitest';
import { formatJstIsoDate, jstDateFormat, jstDateFromIso } from './jst';

describe('jstDateFromIso', () => {
    it('is 00:00 in Tokyo on that date (15:00 UTC the day before)', () => {
        expect(jstDateFromIso('2026-01-01')?.toISOString()).toBe('2025-12-31T15:00:00.000Z');
        expect(jstDateFromIso('2024-02-29')?.toISOString()).toBe('2024-02-28T15:00:00.000Z');
    });

    it.each(['', '2026-1-01', '2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '２０２６-01-01', '2026-01-01T00:00'])(
        'refuses %j',
        (value) => {
            expect(jstDateFromIso(value)).toBeNull();
        },
    );
});

describe('formatJstIsoDate', () => {
    it('formats the JST day whatever the formatter language', () => {
        const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
        expect(formatJstIsoDate(fmt, '2026-01-01')).toBe('2026-01-01');
        expect(formatJstIsoDate(jstDateFormat('ja'), '2026-08-21')).toBe('2026年8月21日');
    });

    it('returns a malformed date as is instead of throwing', () => {
        expect(formatJstIsoDate(jstDateFormat('ja'), 'bad')).toBe('bad');
    });
});
