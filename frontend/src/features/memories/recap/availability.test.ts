import { describe, it, expect, afterAll, afterEach, beforeAll, vi } from 'vitest';
import { defaultRecapYear, formatJstClock, formatJstDate, jstNow, offeredRecapYears, recapAvailability } from './availability';

// Run under a zone west of UTC so an implementation built on local getters (plus 9 h)
// would fail here even when CI runs in UTC.
const savedTz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/Los_Angeles'; });
afterAll(() => { process.env.TZ = savedTz; });

/** A JST wall-clock instant as a `Date` (JST is UTC+9 all year). */
const jst = (iso: string) => new Date(`${iso}+09:00`);

afterEach(() => { vi.useRealTimers(); });

describe('jstNow', () => {
    it('runs under a non-UTC local zone', () => {
        // Nov 30 07:00 PST, which is already Dec 1 00:00 in Tokyo.
        const instant = new Date('2026-11-30T15:00:00Z');
        expect(instant.getDate()).toBe(30);
        expect(instant.getHours()).toBe(7);
        expect(jstNow(instant)).toMatchObject({ month: 12, day: 1, hour: 0 });
        expect(recapAvailability(instant).currentOpen).toBe(true);
    });

    it('reads the wall clock in Asia/Tokyo, not the local zone', () => {
        // 2026-11-30 15:00 UTC is already Dec 1 in Tokyo.
        expect(jstNow(new Date('2026-11-30T15:00:00Z'))).toEqual({ year: 2026, month: 12, day: 1, hour: 0, minute: 0 });
        expect(jstNow(new Date('2026-12-31T14:59:00Z'))).toEqual({ year: 2026, month: 12, day: 31, hour: 23, minute: 59 });
    });

    it('defaults to the current time', () => {
        vi.useFakeTimers();
        vi.setSystemTime(jst('2027-01-01T00:00:00'));
        expect(jstNow()).toMatchObject({ year: 2027, month: 1, day: 1 });
    });
});

describe('recapAvailability', () => {
    it.each([
        ['2026-11-30T23:59:00', { year: 2026, currentOpen: false, maxYear: 2025, defaultYear: 2025 }],
        ['2026-12-01T00:00:00', { year: 2026, currentOpen: true, maxYear: 2026, defaultYear: 2026 }],
        ['2026-12-31T23:59:00', { year: 2026, currentOpen: true, maxYear: 2026, defaultYear: 2026 }],
        ['2027-01-01T00:00:00', { year: 2027, currentOpen: false, maxYear: 2026, defaultYear: 2026 }],
    ])('at %s JST', (instant, expected) => {
        vi.useFakeTimers();
        vi.setSystemTime(jst(instant));
        expect(recapAvailability()).toEqual(expected);
    });

    it('before Dec 1 only past years are offered; the current year opens on Dec 1 as partial', () => {
        const before = recapAvailability(jst('2026-11-30T23:59:00'));
        expect(offeredRecapYears(before, [2024, 2025, 2026])).toEqual([2024, 2025]);
        const open = recapAvailability(jst('2026-12-01T00:00:00'));
        expect(offeredRecapYears(open, [2024, 2025])).toEqual([2024, 2025, 2026]);
        expect(defaultRecapYear(open, offeredRecapYears(open, [2024, 2025]))).toBe(2026);
    });

    it('from Jan 1 the year just ended comes first', () => {
        const ny = recapAvailability(jst('2027-01-01T00:00:00'));
        const years = offeredRecapYears(ny, [2025, 2026, 2027]);
        expect(years).toEqual([2025, 2026]);
        expect(defaultRecapYear(ny, years)).toBe(2026);
    });

    it('falls back to the newest year with data when the default year has none', () => {
        const ny = recapAvailability(jst('2027-03-01T12:00:00'));
        expect(defaultRecapYear(ny, offeredRecapYears(ny, [2024]))).toBe(2024);
    });

    it('offers nothing before Dec 1 when no past year has data', () => {
        const before = recapAvailability(jst('2026-11-10T12:00:00'));
        const years = offeredRecapYears(before, []);
        expect(years).toEqual([]);
        expect(defaultRecapYear(before, years)).toBeNull();
    });

    it('without the shelf (unknown) offers every year up to the newest open one', () => {
        const before = recapAvailability(jst('2026-11-10T12:00:00'));
        const years = offeredRecapYears(before, null);
        expect(years[0]).toBe(2020);
        expect(years[years.length - 1]).toBe(2025);
    });

    it('drops years before the first year the API accepts', () => {
        const open = recapAvailability(jst('2026-12-05T12:00:00'));
        expect(offeredRecapYears(open, [2019, 2021])).toEqual([2021, 2026]);
    });
});

describe('formatJstClock', () => {
    it('shows the Tokyo wall clock whatever the machine zone (here Los Angeles)', () => {
        expect(formatJstClock('2024-09-13T15:30:00Z')).toBe('00:30');
        expect(formatJstClock(new Date('2024-09-14T12:52:00Z'))).toBe('21:52');
    });
    it('is empty for an invalid timestamp', () => {
        expect(formatJstClock('nope')).toBe('');
    });
});

describe('formatJstDate', () => {
    it('shows the Tokyo calendar date, which may be the next UTC day', () => {
        expect(formatJstDate('2023-12-31T14:59:00Z')).toBe('2023-12-31');
        expect(formatJstDate('2023-12-31T15:00:00Z')).toBe('2024-01-01');
    });
    it('is empty for an invalid timestamp', () => {
        expect(formatJstDate('nope')).toBe('');
    });
});
