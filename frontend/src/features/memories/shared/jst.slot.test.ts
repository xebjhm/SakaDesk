import { describe, it, expect } from 'vitest';
import { isJstSlot, jstSlotToLocal } from './jst';

describe('jstSlotToLocal', () => {
    it('shows the New York time of the JST slot (the day before, time only)', () => {
        expect(jstSlotToLocal('12:00', { now: new Date('2026-07-01T00:00:00Z'), timeZone: 'America/New_York' })).toBe('23:00');
    });

    it('follows New York standard time in winter', () => {
        expect(jstSlotToLocal('12:00', { now: new Date('2026-01-15T00:00:00Z'), timeZone: 'America/New_York' })).toBe('22:00');
    });

    it('follows London across the DST change', () => {
        expect(jstSlotToLocal('12:00', { now: new Date('2026-01-15T00:00:00Z'), timeZone: 'Europe/London' })).toBe('03:00');
        expect(jstSlotToLocal('12:00', { now: new Date('2026-07-15T00:00:00Z'), timeZone: 'Europe/London' })).toBe('04:00');
    });

    it('uses the JST date of the slot around the DST switch day', () => {
        // 2026-03-08 is the US spring-forward day: the slot on JST Mar 8 is 03:00Z, still EST (Mar 7 22:00).
        expect(jstSlotToLocal('12:00', { now: new Date('2026-03-08T01:00:00Z'), timeZone: 'America/New_York' })).toBe('22:00');
        // JST Mar 9 12:00 is 03:00Z Mar 9, after the switch (EDT, 23:00).
        expect(jstSlotToLocal('12:00', { now: new Date('2026-03-09T01:00:00Z'), timeZone: 'America/New_York' })).toBe('23:00');
    });

    it('keeps minutes and midnight in a 24 h clock', () => {
        expect(jstSlotToLocal('00:30', { now: new Date('2026-01-15T00:00:00Z'), timeZone: 'Europe/London' })).toBe('15:30');
        expect(jstSlotToLocal('09:00', { now: new Date('2026-01-15T00:00:00Z'), timeZone: 'Europe/London' })).toBe('00:00');
    });

    it('returns null in Asia/Tokyo', () => {
        expect(jstSlotToLocal('12:00', { now: new Date('2026-07-01T00:00:00Z'), timeZone: 'Asia/Tokyo' })).toBeNull();
    });

    it.each(['25:00', '12:60', '7:00', '', '１２:００', '12:00:00'])('returns null for the malformed %j', (value) => {
        expect(jstSlotToLocal(value, { now: new Date('2026-07-01T00:00:00Z'), timeZone: 'Europe/London' })).toBeNull();
    });
});

describe('isJstSlot', () => {
    it.each([['00:00', true], ['23:59', true], ['24:00', false], ['7:00', false], ['１２:００', false]])('%j -> %s', (value, ok) => {
        expect(isJstSlot(value)).toBe(ok);
    });
});
