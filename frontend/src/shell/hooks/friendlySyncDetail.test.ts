import { describe, it, expect } from 'vitest';
import { friendlySyncDetail } from './useSync';

// SD-FE-GAP-B-08: unknown machine sentinels must never render verbatim.
describe('friendlySyncDetail', () => {
  it('passes ordinary human-readable progress text through unchanged', () => {
    expect(friendlySyncDetail('Fetching page 3', 'FALLBACK')).toBe('Fetching page 3');
    expect(friendlySyncDetail('Downloading media...', 'FALLBACK')).toBe('Downloading media...');
  });

  it('replaces an ALL_CAPS_UNDERSCORE sentinel with the fallback', () => {
    expect(friendlySyncDetail('SESSION_EXPIRED', 'FALLBACK')).toBe('FALLBACK');
    expect(friendlySyncDetail('REFRESH_FAILED', 'FALLBACK')).toBe('FALLBACK');
    expect(friendlySyncDetail('SOME_NEW_UNKNOWN_CODE', 'FALLBACK')).toBe('FALLBACK');
  });

  it('does not treat a single uppercase word as a sentinel (no underscore)', () => {
    // e.g. "ERROR" alone is not our sentinel shape; leave it (rare) rather than
    // hide potentially-useful text. Only underscore-joined codes are masked.
    expect(friendlySyncDetail('DONE', 'FALLBACK')).toBe('DONE');
  });

  it('returns undefined for empty/non-string detail', () => {
    expect(friendlySyncDetail(undefined, 'FALLBACK')).toBeUndefined();
    expect(friendlySyncDetail('', 'FALLBACK')).toBeUndefined();
    expect(friendlySyncDetail(null, 'FALLBACK')).toBeUndefined();
  });
});
