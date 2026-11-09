import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/clientLog', async (orig) => ({
  ...(await orig<typeof import('../../utils/clientLog')>()),
  clientLog: vi.fn(),
}));

import { clientLog } from '../../utils/clientLog';
import * as api from './appStateApi';
import { persisted, CONV_HYDRATE_RETRY_DELAYS_MS } from './persisted';

const TOTAL_RETRY_MS = CONV_HYDRATE_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);

/** Run a hydration whose retries wait on (fake) timers to completion. */
async function hydrateWithTimers(): Promise<void> {
  const done = persisted.hydrateConversations();
  await vi.advanceTimersByTimeAsync(TOTAL_RETRY_MS);
  await done;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(clientLog).mockClear();
});
afterEach(() => vi.useRealTimers());

describe('persisted conversation cache', () => {
  it('hydrates then serves sync reads with fallback for missing keys', async () => {
    vi.spyOn(api, 'getAllConversations').mockResolvedValue({
      read_state_a: { value: '{"x":1}' },
    });

    await persisted.hydrateConversations();

    expect(persisted.getConv<{ value?: string }>('read_state_a', {}).value).toBe('{"x":1}');
    expect(persisted.getConv('missing', { def: 1 })).toEqual({ def: 1 });
  });

  it('setConv updates the cache synchronously and PATCHes backend', async () => {
    vi.spyOn(api, 'getAllConversations').mockResolvedValue({});
    const patch = vi.spyOn(api, 'patchConversation').mockResolvedValue(undefined as never);
    await persisted.hydrateConversations();

    persisted.setConv('sakadesk_scroll_58', { value: '42' });

    expect(persisted.getConv<{ value?: string }>('sakadesk_scroll_58', {}).value).toBe('42'); // sync
    await vi.waitFor(() =>
      expect(patch).toHaveBeenCalledWith('sakadesk_scroll_58', { value: '42' })
    );
  });

  it('reports ready only after a successful load', async () => {
    vi.spyOn(api, 'getAllConversations').mockResolvedValue({});
    await persisted.hydrateConversations();
    expect(persisted.conversationsReady()).toBe(true);
  });

  it('keeps the loaded cache and stays ready when a later load fails', async () => {
    vi.spyOn(api, 'getAllConversations').mockResolvedValueOnce({ read_state_a: { value: '1' } });
    await persisted.hydrateConversations();
    expect(persisted.conversationsReady()).toBe(true);
    vi.useFakeTimers();
    vi.spyOn(api, 'getAllConversations').mockRejectedValue(new Error('down'));
    await hydrateWithTimers();
    expect(persisted.conversationsReady()).toBe(true);
    expect(persisted.getConv<{ value?: string }>('read_state_a', {}).value).toBe('1');
  });

  it('retries a failed load with backoff and becomes ready when a retry succeeds', async () => {
    vi.useFakeTimers();
    const load = vi.spyOn(api, 'getAllConversations')
      .mockRejectedValueOnce(new api.AppStateHttpError(503))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ read_state_a: { value: '1' } });
    const done = persisted.hydrateConversations();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CONV_HYDRATE_RETRY_DELAYS_MS[0] - 1);
    expect(load).toHaveBeenCalledTimes(1); // still backing off
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CONV_HYDRATE_RETRY_DELAYS_MS[1]);
    await done;
    expect(load).toHaveBeenCalledTimes(3);
    expect(persisted.conversationsReady()).toBe(true);
    expect(persisted.getConv<{ value?: string }>('read_state_a', {}).value).toBe('1');
    expect(vi.mocked(clientLog).mock.calls).toEqual([
      ['conv_hydrate_retry', { index: 1, error_type: 'appstatehttperror', error_code: 503 }],
      ['conv_hydrate_retry', { index: 2, error_type: 'typeerror' }],
    ]);
  });

  it('gives up after the last retry and logs conv_hydrate_failed once', async () => {
    // Fresh module instance: the cache above is already ready, and this case needs a never-loaded cache.
    vi.resetModules();
    const fresh = await import('./persisted');
    const freshApi = await import('./appStateApi');
    const freshLog = await import('../../utils/clientLog');
    vi.mocked(freshLog.clientLog).mockClear();
    vi.useFakeTimers();
    const load = vi.spyOn(freshApi, 'getAllConversations').mockRejectedValue(new freshApi.AppStateHttpError(500));
    const done = fresh.persisted.hydrateConversations();
    await vi.advanceTimersByTimeAsync(fresh.CONV_HYDRATE_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0));
    await done;
    expect(load).toHaveBeenCalledTimes(fresh.CONV_HYDRATE_RETRY_DELAYS_MS.length + 1);
    expect(fresh.persisted.conversationsReady()).toBe(false);
    const failed = vi.mocked(freshLog.clientLog).mock.calls.filter(([e]) => e === 'conv_hydrate_failed');
    expect(failed).toEqual([
      ['conv_hydrate_failed', { count: fresh.CONV_HYDRATE_RETRY_DELAYS_MS.length + 1, error_type: 'appstatehttperror', error_code: 500 }],
    ]);
  });

  it('setConv logs conv_write_failed (error code only) when the PATCH is refused', async () => {
    vi.spyOn(api, 'getAllConversations').mockResolvedValue({});
    await persisted.hydrateConversations();
    vi.spyOn(api, 'patchConversation').mockRejectedValue(new api.AppStateHttpError(500));
    persisted.setConv('read_state_日向坂46/messages/34 金村', { value: '{}' });
    await vi.waitFor(() =>
      expect(clientLog).toHaveBeenCalledWith('conv_write_failed', { error_type: 'appstatehttperror', error_code: 500 })
    );
    expect(JSON.stringify(vi.mocked(clientLog).mock.calls)).not.toMatch(/金村|read_state/);
  });
});
