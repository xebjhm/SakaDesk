import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { toLocalDateStr } from './dateFormatters';

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
