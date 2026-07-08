import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from './appStateApi';
import { persisted } from './persisted';

// The global test setup (src/__tests__/setup.ts) replaces window.localStorage
// with bare vi.fn() stubs that don't actually store anything. This suite
// needs a real, working localStorage, so install a minimal in-memory
// implementation for the duration of these tests.
function installFakeLocalStorage() {
  let store: Record<string, string> = {};
  const fake = {
    getItem: vi.fn((k: string) => (k in store ? store[k] : null)),
    setItem: vi.fn((k: string, v: string) => { store[k] = String(v); }),
    removeItem: vi.fn((k: string) => { delete store[k]; }),
    clear: vi.fn(() => { store = {}; }),
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    get length() { return Object.keys(store).length; },
  };
  Object.defineProperty(window, 'localStorage', { value: fake, configurable: true });
}

beforeEach(() => {
  vi.restoreAllMocks();
  installFakeLocalStorage();
});

describe('persisted.migrateOnce', () => {
  it('migrates scalar prefs + a conversation key + a translation, keyed correctly', async () => {
    localStorage.setItem('tos_accepted_at', '2026-01-01T00:00:00Z');
    localStorage.setItem('sakadesk-language', 'ja');
    localStorage.setItem('sakadesk-app-state', JSON.stringify({ state: { selectedServices: ['hinatazaka46'] }, version: 4 }));
    localStorage.setItem('read_state_hinatazaka46/messages/58 X', JSON.stringify({ up_to: 9 }));
    localStorage.setItem('sakadesk_scroll_58', '4242');
    localStorage.setItem('translation:message:12:ja', 'こんにちは');
    localStorage.setItem('translation:group-name:34:en', 'Hello Group');
    vi.spyOn(api, 'getMigrated').mockResolvedValue({ migrated: false });
    const post = vi.spyOn(api, 'postMigrate').mockResolvedValue(undefined as never);
    vi.spyOn(api, 'getPrefs').mockResolvedValue({});

    await persisted.migrateOnce();

    const dump = post.mock.calls[0][0] as any;
    expect(dump.prefs).toEqual({
        tos_accepted_at: '2026-01-01T00:00:00Z',
        language: 'ja',
        'sakadesk-app-state': JSON.stringify({ state: { selectedServices: ['hinatazaka46'] }, version: 4 }),
    });
    expect(dump.conversations['read_state_hinatazaka46/messages/58 X']).toEqual({ value: JSON.stringify({ up_to: 9 }) });
    expect(dump.conversations['sakadesk_scroll_58']).toEqual({ value: '4242' });
    expect(dump.translations).toEqual({
      'translation:message:12:ja': 'こんにちは',
      'translation:group-name:34:en': 'Hello Group',
    });
  });

  it('is a no-op when already migrated', async () => {
    vi.spyOn(api, 'getMigrated').mockResolvedValue({ migrated: true });
    const post = vi.spyOn(api, 'postMigrate').mockResolvedValue(undefined as never);

    await persisted.migrateOnce();

    expect(post).not.toHaveBeenCalled();
  });

  it('is safe when the backend is unreachable', async () => {
    vi.spyOn(api, 'getMigrated').mockRejectedValue(new Error('offline'));
    const post = vi.spyOn(api, 'postMigrate').mockResolvedValue(undefined as never);

    await expect(persisted.migrateOnce()).resolves.toBeUndefined();

    expect(post).not.toHaveBeenCalled();
  });
});
