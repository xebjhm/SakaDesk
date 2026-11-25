import { describe, it, expect } from 'vitest';
import { buildMonthGrid, dayTone, pickerYearRange, weekdayTone } from './monthGrid';

describe('buildMonthGrid', () => {
    it('always gives six weeks of cells starting on a Sunday', () => {
        const cells = buildMonthGrid(2026, 10); // November 2026 starts on a Sunday
        expect(cells).toHaveLength(42);
        expect(cells[0].date.getDay()).toBe(0);
        expect(cells[0]).toMatchObject({ dateStr: '2026-11-01', inMonth: true });
        expect(cells[29]).toMatchObject({ dateStr: '2026-11-30', inMonth: true });
        expect(cells[30]).toMatchObject({ dateStr: '2026-12-01', inMonth: false });
        expect(cells[41].dateStr).toBe('2026-12-12');
    });

    it('fills the leading week from the previous month when the 1st is a Saturday', () => {
        const cells = buildMonthGrid(2025, 10); // November 2025: the 1st is a Saturday
        expect(cells).toHaveLength(42);
        expect(cells.slice(0, 6).map((c) => c.dateStr)).toEqual([
            '2025-10-26', '2025-10-27', '2025-10-28', '2025-10-29', '2025-10-30', '2025-10-31',
        ]);
        expect(cells.slice(0, 6).every((c) => !c.inMonth)).toBe(true);
        expect(cells[6]).toMatchObject({ dateStr: '2025-11-01', inMonth: true });
        expect(cells[6].date.getDay()).toBe(6);
    });

    it('counts the 29th of a leap February in the month', () => {
        const inMonth = buildMonthGrid(2024, 1).filter((c) => c.inMonth).map((c) => c.dateStr);
        expect(inMonth).toHaveLength(29);
        expect(inMonth[inMonth.length - 1]).toBe('2024-02-29');
        expect(buildMonthGrid(2023, 1).filter((c) => c.inMonth)).toHaveLength(28);
    });

    it('crosses the year at both ends', () => {
        const jan = buildMonthGrid(2025, 0); // 1 Jan 2025 is a Wednesday
        expect(jan[0].dateStr).toBe('2024-12-29');
        const dec = buildMonthGrid(2024, 11);
        expect(dec[41].dateStr).toBe('2025-01-11');
    });
});

describe('dayTone', () => {
    it('reads Sundays and 祝日 as holiday and Saturdays as saturday', () => {
        expect(dayTone(new Date(2024, 8, 15))).toBe('holiday'); // Sunday
        expect(dayTone(new Date(2024, 8, 16))).toBe('holiday'); // 敬老の日 (Monday)
        expect(dayTone(new Date(2024, 8, 14))).toBe('saturday');
        expect(dayTone(new Date(2024, 8, 17))).toBeNull();
    });

    it('colours the weekday header by column', () => {
        expect(weekdayTone(0)).toBe('holiday');
        expect(weekdayTone(6)).toBe('saturday');
        expect([1, 2, 3, 4, 5].map(weekdayTone)).toEqual([null, null, null, null, null]);
    });
});

describe('pickerYearRange', () => {
    it('runs from the first dated year to this year', () => {
        expect(pickerYearRange([2023, 2021], 2024, 2026)).toEqual([2021, 2022, 2023, 2024, 2025, 2026]);
    });

    it('offers the last ten years without dates, and always the year on screen', () => {
        expect(pickerYearRange([], 2026, 2026)).toEqual([2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
        expect(pickerYearRange([2024], 2019, 2026)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
        expect(pickerYearRange([2028], 2026, 2026)).toEqual([2026, 2027, 2028]);
    });
});
