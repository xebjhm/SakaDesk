import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from './appStateApi';
import { persisted } from './persisted';

beforeEach(() => vi.restoreAllMocks());

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
});
