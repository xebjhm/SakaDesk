import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from './appStateApi';
import { persisted } from './persisted';

beforeEach(() => vi.restoreAllMocks());

describe('persisted prefs', () => {
  it('hydrates then serves sync reads', async () => {
    vi.spyOn(api, 'getPrefs').mockResolvedValue({ language: 'ja' });
    await persisted.hydratePrefs();
    expect(persisted.getPref('language', 'en')).toBe('ja');
    expect(persisted.getPref('missing', 'def')).toBe('def');
  });

  it('setPref updates memory immediately and PATCHes backend', async () => {
    vi.spyOn(api, 'getPrefs').mockResolvedValue({});
    const patch = vi.spyOn(api, 'patchPrefs').mockResolvedValue(undefined as never);
    await persisted.hydratePrefs();
    persisted.setPref('language', 'yue');
    expect(persisted.getPref('language', 'en')).toBe('yue'); // sync
    await vi.waitFor(() => expect(patch).toHaveBeenCalledWith({ language: 'yue' }));
  });
});
