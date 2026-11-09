import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { persisted } from './persisted';
import {
    loadCachedTranslation,
    TRANSLATION_BATCH_MAX_KEYS,
    TRANSLATION_BATCH_WINDOW_MS,
} from './translationLoader';
import { clientLog } from '../../utils/clientLog';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

const store = new Map<string, string>();
let getSpy: ReturnType<typeof vi.spyOn>;

describe('loadCachedTranslation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        store.clear();
        vi.mocked(clientLog).mockClear();
        getSpy = vi.spyOn(persisted, 'getTranslations').mockImplementation(async (keys: string[]) => {
            const out: Record<string, string> = {};
            for (const k of keys) if (store.has(k)) out[k] = store.get(k)!;
            return out;
        });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('answers N callers within the window with one request', async () => {
        store.set('k:1', 'one');
        store.set('k:3', 'three');
        const results = ['k:1', 'k:2', 'k:3'].map((k) => loadCachedTranslation(k));
        expect(getSpy).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(TRANSLATION_BATCH_WINDOW_MS);
        expect(getSpy).toHaveBeenCalledTimes(1);
        expect(getSpy).toHaveBeenCalledWith(['k:1', 'k:2', 'k:3']);
        await expect(Promise.all(results)).resolves.toEqual(['one', undefined, 'three']);
    });

    it('splits a batch larger than the maximum into several requests', async () => {
        const keys = Array.from({ length: TRANSLATION_BATCH_MAX_KEYS * 2 + 1 }, (_, i) => `s:${i}`);
        const results = keys.map((k) => loadCachedTranslation(k));
        await vi.advanceTimersByTimeAsync(TRANSLATION_BATCH_WINDOW_MS);
        expect(getSpy.mock.calls.map(([k]: unknown[]) => (k as string[]).length)).toEqual([
            TRANSLATION_BATCH_MAX_KEYS,
            TRANSLATION_BATCH_MAX_KEYS,
            1,
        ]);
        await expect(Promise.all(results)).resolves.toHaveLength(keys.length);
    });

    it('dedupes a key that is queued or already in flight', async () => {
        store.set('d:1', 'x');
        const a = loadCachedTranslation('d:1');
        const b = loadCachedTranslation('d:1');
        expect(b).toBe(a);
        await vi.advanceTimersByTimeAsync(TRANSLATION_BATCH_WINDOW_MS);
        expect(getSpy).toHaveBeenCalledWith(['d:1']);
        let release!: () => void;
        getSpy.mockImplementationOnce(() => new Promise((r) => { release = () => r({ 'd:2': 'y' }); }));
        const c = loadCachedTranslation('d:2');
        await vi.advanceTimersByTimeAsync(TRANSLATION_BATCH_WINDOW_MS);
        const dup = loadCachedTranslation('d:2'); // while in flight
        await vi.advanceTimersByTimeAsync(TRANSLATION_BATCH_WINDOW_MS);
        expect(getSpy).toHaveBeenCalledTimes(2);
        release();
        await expect(Promise.all([a, b, c, dup])).resolves.toEqual(['x', 'x', 'y', 'y']);
    });

    it('rejects every waiting caller on failure and logs one breadcrumb without keys', async () => {
        getSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const outcomes = ['f:1', 'f:2', 'f:3'].map((k) => loadCachedTranslation(k).then(() => 'ok', () => 'rejected'));
        await vi.advanceTimersByTimeAsync(TRANSLATION_BATCH_WINDOW_MS);
        await expect(Promise.all(outcomes)).resolves.toEqual(['rejected', 'rejected', 'rejected']);
        expect(clientLog).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('translation_batch_failed', { count: 3, error_type: 'typeerror' });
    });

    it('looks the key up again after a failure (nothing stays cached)', async () => {
        getSpy.mockRejectedValueOnce(new Error('boom'));
        const first = loadCachedTranslation('r:1').catch(() => 'rejected');
        await vi.advanceTimersByTimeAsync(TRANSLATION_BATCH_WINDOW_MS);
        await expect(first).resolves.toBe('rejected');
        store.set('r:1', 'ok');
        const second = loadCachedTranslation('r:1');
        await vi.advanceTimersByTimeAsync(TRANSLATION_BATCH_WINDOW_MS);
        await expect(second).resolves.toBe('ok');
    });
});
