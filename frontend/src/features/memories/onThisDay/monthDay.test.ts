import { describe, it, expect } from 'vitest';
import { shiftMonthDay, todayMonthDay } from './monthDay';

describe('monthDay', () => {
    it('reads today in JST, not UTC', () => {
        // 2026-01-01 00:30 JST is still 2025-12-31 in UTC.
        expect(todayMonthDay(new Date('2025-12-31T15:30:00Z'))).toBe('01-01');
    });

    it('steps over 02-29 and around the year end', () => {
        expect(shiftMonthDay('02-28', 1)).toBe('02-29');
        expect(shiftMonthDay('03-01', -1)).toBe('02-29');
        expect(shiftMonthDay('12-31', 1)).toBe('01-01');
        expect(shiftMonthDay('01-01', -1)).toBe('12-31');
    });
});
