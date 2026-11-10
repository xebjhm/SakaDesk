import { describe, it, expect } from 'vitest';
import { sepiaClass } from './sepia';

// JST wall clock: 2026-01-01 00:30 JST is still 2025-12-31 in UTC.
const NEW_YEAR_JST = new Date('2025-12-31T15:30:00Z');

describe('sepiaClass', () => {
    const now = new Date('2026-06-01T03:00:00Z');
    it('leaves this year in colour', () => {
        expect(sepiaClass(2026, now)).toBe('');
    });
    it('ages one, two and three-or-more years', () => {
        expect(sepiaClass(2025, now)).toBe('sepia-memories-1');
        expect(sepiaClass(2024, now)).toBe('sepia-memories-2');
        expect(sepiaClass(2023, now)).toBe('sepia-memories-3');
        expect(sepiaClass(2015, now)).toBe('sepia-memories-3');
    });
    it('never ages a future year', () => {
        expect(sepiaClass(2027, now)).toBe('');
    });
    it('counts years in JST, not local or UTC time', () => {
        expect(sepiaClass(2026, NEW_YEAR_JST)).toBe('');
        expect(sepiaClass(2025, NEW_YEAR_JST)).toBe('sepia-memories-1');
    });
});
