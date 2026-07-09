import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as api from './appStateApi';
import { persisted } from './persisted';

// SD-FE-STATE-03 / SD-FE-STATE-04: the debounced prefs flush must (a) re-queue
// a failed PATCH instead of silently dropping it, and (b) expose a synchronous
// flushNow() for close-time (pagehide) persistence.
describe('persisted flush resilience', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-queues a failed PATCH instead of dropping it (SD-FE-STATE-04)', async () => {
    vi.spyOn(api, 'getPrefs').mockResolvedValue({});
    await persisted.hydratePrefs();

    const patch = vi
      .spyOn(api, 'patchPrefs')
      .mockRejectedValueOnce(new Error('SQLite busy')) // first flush fails
      .mockResolvedValue(undefined as never); // retry succeeds

    persisted.setPref('tos_accepted_at', '2026-07-08');

    // First debounce fires and rejects.
    await vi.advanceTimersByTimeAsync(300);
    expect(patch).toHaveBeenNthCalledWith(1, { tos_accepted_at: '2026-07-08' });

    // The value must be re-queued and retried (with backoff), not lost.
    await vi.advanceTimersByTimeAsync(2000);
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenNthCalledWith(2, { tos_accepted_at: '2026-07-08' });
  });

  it('does not clobber a newer value when re-queuing a failed key (SD-FE-STATE-04)', async () => {
    vi.spyOn(api, 'getPrefs').mockResolvedValue({});
    await persisted.hydratePrefs();

    let rejectFirst!: (e: unknown) => void;
    const firstCall = new Promise<undefined>((_, reject) => { rejectFirst = reject; });
    const patch = vi
      .spyOn(api, 'patchPrefs')
      .mockImplementationOnce(() => firstCall)
      .mockResolvedValue(undefined as never);

    persisted.setPref('language', 'ja');
    await vi.advanceTimersByTimeAsync(300); // first flush in flight with 'ja'

    // A newer write lands while the first PATCH is still in flight.
    persisted.setPref('language', 'yue');

    // Now the first PATCH fails — it must NOT overwrite the newer 'yue'.
    rejectFirst(new Error('boom'));
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(2000);
    // The retry must send the newest value, never revert to 'ja'.
    const lastCall = patch.mock.calls[patch.mock.calls.length - 1][0];
    expect(lastCall).toEqual({ language: 'yue' });
    expect(persisted.getPref('language', 'en')).toBe('yue');
  });

  it('flushNow() sends pending immediately via keepalive beacon (SD-FE-STATE-03)', async () => {
    vi.spyOn(api, 'getPrefs').mockResolvedValue({});
    const beacon = vi.spyOn(api, 'patchPrefsBeacon').mockReturnValue(true);
    await persisted.hydratePrefs();

    persisted.setPref('dismissed_update', '0.3.2');
    // Before the 300ms debounce elapses, a close-time flush must still persist it.
    persisted.flushNow();

    expect(beacon).toHaveBeenCalledWith({ dismissed_update: '0.3.2' });
  });

  it('flushNow() is a no-op when nothing is pending (SD-FE-STATE-03)', async () => {
    vi.spyOn(api, 'getPrefs').mockResolvedValue({});
    const beacon = vi.spyOn(api, 'patchPrefsBeacon').mockReturnValue(true);
    await persisted.hydratePrefs();

    persisted.flushNow();
    expect(beacon).not.toHaveBeenCalled();
  });
});
