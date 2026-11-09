import { describe, it, expect } from 'vitest';
import { holidayName } from './jpHolidays';

describe('holidayName', () => {
    it('names Japanese public holidays in Japanese', () => {
        expect(holidayName(new Date(2026, 10, 3))).toBe('文化の日');
        expect(holidayName(new Date(2026, 10, 23))).toBe('勤労感謝の日');
        expect(holidayName(new Date(2026, 0, 1))).toBe('元日');
    });

    it('names a substitute holiday (Constitution Day 2026 falls on a Sunday)', () => {
        expect(holidayName(new Date(2026, 4, 3))).toBe('憲法記念日');
        expect(holidayName(new Date(2026, 4, 6))).toContain('振替休日');
    });

    it('accepts a local "YYYY-MM-DD" day string', () => {
        expect(holidayName('2026-11-03')).toBe('文化の日');
        expect(holidayName('2026-11-04')).toBeNull();
    });

    it('reads the local calendar day, not the UTC one', () => {
        // Late evening local time is still Culture Day whatever the UTC date is.
        expect(holidayName(new Date(2026, 10, 3, 23, 59))).toBe('文化の日');
        expect(holidayName(new Date(2026, 10, 3, 0, 0))).toBe('文化の日');
    });

    it('returns null for ordinary days, invalid input and days outside the dataset', () => {
        expect(holidayName(new Date(2026, 5, 15))).toBeNull();
        expect(holidayName(new Date(Number.NaN))).toBeNull();
        expect(holidayName('not-a-date')).toBeNull();
        expect(holidayName(new Date(2100, 0, 1))).toBeNull();
    });
});
