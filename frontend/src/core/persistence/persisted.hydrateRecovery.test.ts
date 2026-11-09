import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

describe('conversation hydration recovery (spec B2 §1)', () => {
    beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('keeps retrying in the background and notifies listeners once ready', async () => {
        let calls = 0;
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (String(url).includes('/conversation-all')) {
                calls += 1;
                if (calls <= 5) return { ok: false, status: 503, json: async () => ({}) } as Response;
                return { ok: true, json: async () => ({ read_state_a: { value: '{}' } }) } as Response;
            }
            return { ok: true, json: async () => ({}) } as Response;
        }));
        const { persisted } = await import('./persisted');
        const { clientLog } = await import('../../utils/clientLog');
        const ready = vi.fn();
        persisted.onConversationsReady(ready);
        const first = persisted.hydrateConversations();
        await vi.advanceTimersByTimeAsync(3500); // 500 + 1000 + 2000
        await first;
        expect(persisted.conversationsReady()).toBe(false);
        await vi.advanceTimersByTimeAsync(5000); // background #1 (call 5) fails
        expect(persisted.conversationsReady()).toBe(false);
        await vi.advanceTimersByTimeAsync(15000); // background #2 (call 6) succeeds
        expect(persisted.conversationsReady()).toBe(true);
        expect(ready).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('conv_hydrate_recovered', expect.objectContaining({ count: 6 }));
    });
});
