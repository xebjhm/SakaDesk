import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { toLocalDateStr, formatDatePillLabel, fromLocalDateStr, toValidDate } from './dateFormatters';

// SD-FE-CORE-02: bucket/match by LOCAL date, matching what message bubbles show.
describe('toLocalDateStr', () => {
  describe('in a fixed JST (+09:00) local timezone', () => {
    beforeAll(() => {
      // Freeze the environment's timezone-offset so getHours/getDate reflect JST
      // regardless of the CI machine's zone. jsdom respects the process TZ, but
      // to be robust we shift Date via a spy on the offset-sensitive getters is
      // fragile; instead we pin TZ through the well-known env used by the suite.
      process.env.TZ = 'Asia/Tokyo';
    });
    afterAll(() => {
      delete process.env.TZ;
    });

    it('rolls a late-UTC timestamp forward to the local (next) day', () => {
      // 23:00Z on Jul 6 is 08:00 JST on Jul 7 — the bubble shows Jul 7, so the
      // calendar bucket must be Jul 7, NOT the raw UTC prefix "2026-07-06".
      expect(toLocalDateStr('2026-07-06T23:00:00Z')).toBe('2026-07-07');
    });

    it('keeps a midday-UTC timestamp on the same local day', () => {
      expect(toLocalDateStr('2026-07-07T03:00:00Z')).toBe('2026-07-07');
    });

    it('handles a +09:00-offset timestamp identically', () => {
      expect(toLocalDateStr('2026-07-07T08:00:00+09:00')).toBe('2026-07-07');
    });
  });

  it('returns empty string for an unparseable timestamp', () => {
    expect(toLocalDateStr('not-a-date')).toBe('');
    expect(toLocalDateStr('')).toBe('');
  });

  it('accepts a Date object', () => {
    const d = new Date(2026, 0, 3); // local Jan 3 2026
    expect(toLocalDateStr(d)).toBe('2026-01-03');
  });
});

describe('formatDatePillLabel', () => {
    const t = (key: 'date.today' | 'date.yesterday') => (key === 'date.today' ? 'TODAY' : 'YESTERDAY');
    const now = new Date(2026, 10, 4, 12, 0); // Wed 4 Nov 2026, local time

    it('says today for any time on the same local day', () => {
        expect(formatDatePillLabel(new Date(2026, 10, 4, 0, 5), now, 'ja', t)).toBe('TODAY');
        expect(formatDatePillLabel(new Date(2026, 10, 4, 23, 59), now, 'ja', t)).toBe('TODAY');
    });

    it('says yesterday for the previous local day', () => {
        expect(formatDatePillLabel(new Date(2026, 10, 3, 23, 59), now, 'ja', t)).toBe('YESTERDAY');
    });

    it('shows month, day and weekday without the year in the same year', () => {
        expect(formatDatePillLabel(new Date(2026, 10, 2), now, 'ja', t)).toBe('11月2日(月)');
        expect(formatDatePillLabel(new Date(2026, 10, 2), now, 'zh-TW', t)).toMatch(/^11月2日\s?週一$/); // ICU versions differ on the space before the weekday
        expect(formatDatePillLabel(new Date(2026, 10, 2), now, 'en', t)).toBe('Mon, November 2');
    });

    it('always shows the year for an earlier year', () => {
        expect(formatDatePillLabel(new Date(2025, 10, 2), now, 'ja', t)).toBe('2025年11月2日(日)');
        expect(formatDatePillLabel(new Date(2025, 10, 2), now, 'zh-TW', t)).toMatch(/^2025年11月2日\s?週日$/);
    });

    it('handles the year boundary', () => {
        const newYear = new Date(2027, 0, 1, 10, 0);
        expect(formatDatePillLabel(new Date(2026, 11, 31, 22, 0), newYear, 'ja', t)).toBe('YESTERDAY');
        expect(formatDatePillLabel(new Date(2026, 11, 30), newYear, 'ja', t)).toBe('2026年12月30日(水)');
    });
});

describe('fromLocalDateStr', () => {
  it('turns a local YYYY-MM-DD back into local midnight of that day', () => {
    const d = fromLocalDateStr('2022-01-15')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2022, 0, 15, 0]);
    expect(toLocalDateStr(d)).toBe('2022-01-15');
  });

  it('rejects anything else', () => {
    expect(fromLocalDateStr('')).toBeNull();
    expect(fromLocalDateStr('2022-1-15')).toBeNull();
    expect(fromLocalDateStr('2022-01-15T00:00:00Z')).toBeNull();
  });
});

describe('toValidDate', () => {
  it('parses a valid timestamp and passes a valid Date through', () => {
    expect(toValidDate('2025-10-31T16:19:35Z')?.toISOString()).toBe('2025-10-31T16:19:35.000Z');
    const d = new Date(2026, 0, 1);
    expect(toValidDate(d)).toBe(d);
  });

  it('is null for anything unparseable, so formatting never throws', () => {
    expect(toValidDate('not a date')).toBeNull();
    expect(toValidDate('')).toBeNull();
    expect(toValidDate(new Date(NaN))).toBeNull();
  });
});
