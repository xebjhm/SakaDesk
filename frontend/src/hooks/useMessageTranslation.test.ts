import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMessageTranslation, clearTranslationCache } from './useMessageTranslation';
import { persisted } from '../core/persistence/persisted';
import * as appStateApi from '../core/persistence/appStateApi';
import { __resetTranslationLoaderForTests } from '../core/persistence/translationLoader';
import { clientLog } from '../utils/clientLog';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));

const KEY = 'translation:message:500:en';
const baseParams = {
    service: 'hinatazaka46',
    messageId: 500,
    memberPath: '日向坂46/messages/34 x/58 x',
    targetLanguage: 'en',
};

function mockFetchOk(translation: string) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, translation }),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

// Backend translation cache, faked in-memory and driven through spies on
// `persisted.getTranslations`/`putTranslations` (the async cache API used by
// the hook) instead of localStorage.
const store = new Map<string, string>();

describe('useMessageTranslation', () => {
    beforeEach(() => {
        __resetTranslationLoaderForTests();
        store.clear();
        vi.spyOn(persisted, 'getTranslations').mockImplementation(async (keys: string[]) => {
            const out: Record<string, string> = {};
            for (const k of keys) if (store.has(k)) out[k] = store.get(k)!;
            return out;
        });
        vi.spyOn(persisted, 'putTranslations').mockImplementation(async (items: Record<string, string>) => {
            for (const [k, v] of Object.entries(items)) store.set(k, v);
            return undefined;
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('loads the cached value asynchronously and trigger() skips the API on a cache hit', async () => {
        store.set(KEY, 'cached-en');
        const fetchMock = mockFetchOk('should-not-be-used');

        const { result } = renderHook(() => useMessageTranslation(baseParams));
        // Sync-init no longer has the value; it arrives after the async cache read.
        expect(result.current.translation).toBeNull();

        await waitFor(() => expect(result.current.translation).toBe('cached-en'));
        expect(result.current.state).toBe('done');

        await act(async () => { await result.current.trigger(); });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('trigger() fetches on a cache miss and caches the result', async () => {
        const fetchMock = mockFetchOk('fresh-en');
        const { result } = renderHook(() => useMessageTranslation(baseParams));

        await act(async () => { await result.current.trigger(); });

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(result.current.translation).toBe('fresh-en');
        expect(result.current.state).toBe('done');
        expect(store.get(KEY)).toBe('fresh-en');
    });

    it('retrigger() refetches and overwrites the cache even when cached', async () => {
        store.set(KEY, 'stale-en');
        const fetchMock = mockFetchOk('regenerated-en');
        const { result } = renderHook(() => useMessageTranslation(baseParams));
        await waitFor(() => expect(result.current.translation).toBe('stale-en'));

        await act(async () => { await result.current.retrigger(); });

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(result.current.translation).toBe('regenerated-en');
        expect(store.get(KEY)).toBe('regenerated-en');
    });

    it('re-syncs from the new key when the target language changes', async () => {
        store.set('translation:message:500:ja', 'こんにちは-ja');
        mockFetchOk('unused');

        const { result, rerender } = renderHook(
            (props) => useMessageTranslation(props),
            { initialProps: baseParams }
        );
        expect(result.current.translation).toBeNull(); // no 'en' cache

        rerender({ ...baseParams, targetLanguage: 'ja' });
        await waitFor(() => expect(result.current.translation).toBe('こんにちは-ja'));
        expect(result.current.state).toBe('done');
    });

    it('clearTranslationCache calls the backend clear-translations endpoint', async () => {
        const clearSpy = vi.spyOn(appStateApi, 'clearTranslations').mockResolvedValue(undefined);

        await clearTranslationCache();

        expect(clearSpy).toHaveBeenCalledOnce();
        clearSpy.mockRestore();
    });

    it('clearTranslationCache rejects when the backend refuses or is unreachable', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
        await expect(clearTranslationCache()).rejects.toThrow();
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
        await expect(clearTranslationCache()).rejects.toThrow();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
        await expect(clearTranslationCache()).resolves.toBeUndefined();
    });
});

describe('useMessageTranslation batching', () => {
    // The earlier describe never restores its spies; start these from a clean slate.
    beforeEach(() => {
        vi.restoreAllMocks();
        __resetTranslationLoaderForTests();
        vi.mocked(clientLog).mockClear();
    });
    afterEach(() => vi.restoreAllMocks());

    it('mounting several bubbles together issues one cache lookup', async () => {
        const getSpy = vi.spyOn(persisted, 'getTranslations').mockImplementation(async (keys: string[]) =>
            Object.fromEntries(keys.filter((k) => k.endsWith(':2:en')).map((k) => [k, 'cached-two'])));
        const results = [1, 2, 3].map((id) =>
            renderHook(() => useMessageTranslation({ ...baseParams, messageId: id })).result);
        await waitFor(() => expect(results[1].current.translation).toBe('cached-two'));
        expect(getSpy).toHaveBeenCalledTimes(1);
        expect(getSpy.mock.calls[0][0]).toHaveLength(3);
        expect(results[0].current.state).toBe('idle');
        expect(results[2].current.translation).toBeNull();
    });

    it('stays idle for every bubble when the batch lookup fails', async () => {
        const getSpy = vi.spyOn(persisted, 'getTranslations').mockRejectedValue(new Error('down'));
        const results = [11, 12].map((id) =>
            renderHook(() => useMessageTranslation({ ...baseParams, messageId: id })).result);
        await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(results.map((r) => r.current.state)).toEqual(['idle', 'idle']);
    });

    it('ignores a stale lookup answered after the target language changed', async () => {
        let release!: (m: Record<string, string>) => void;
        vi.spyOn(persisted, 'getTranslations').mockImplementation(((keys: string[]) =>
            keys.some((k) => k.endsWith(':en'))
                ? new Promise((r) => { release = r; })
                : Promise.resolve({ [keys[0]]: 'fresh-ja' })) as typeof persisted.getTranslations);
        const { result, rerender } = renderHook(
            ({ lang }) => useMessageTranslation({ ...baseParams, messageId: 21, targetLanguage: lang }),
            { initialProps: { lang: 'en' } },
        );
        await act(async () => { await new Promise((r) => setTimeout(r, 80)); }); // en lookup now in flight
        rerender({ lang: 'ja' });
        await waitFor(() => expect(result.current.translation).toBe('fresh-ja'));
        await act(async () => { release({ 'translation:message:21:en': 'stale-en' }); });
        expect(result.current.translation).toBe('fresh-ja');
    });

    it('a pending cached lookup does not overwrite state after clear()', async () => {
        let release!: (m: Record<string, string>) => void;
        vi.spyOn(persisted, 'getTranslations').mockImplementation(() => new Promise((r) => { release = r; }));
        const { result } = renderHook(() => useMessageTranslation({ ...baseParams, messageId: 31 }));
        await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
        act(() => result.current.clear());
        await act(async () => { release({ 'translation:message:31:en': 'late' }); });
        expect(result.current.translation).toBeNull();
        expect(result.current.state).toBe('idle');
    });

    it('a pending cached lookup does not overwrite the fresh result of retrigger()', async () => {
        let release!: (m: Record<string, string>) => void;
        vi.spyOn(persisted, 'getTranslations').mockImplementation(() => new Promise((r) => { release = r; }));
        vi.spyOn(persisted, 'putTranslations').mockResolvedValue(undefined);
        mockFetchOk('fresh');
        const { result } = renderHook(() => useMessageTranslation({ ...baseParams, messageId: 41 }));
        await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
        await act(async () => { await result.current.retrigger(); });
        expect(result.current.translation).toBe('fresh');
        await act(async () => { release({ 'translation:message:41:en': 'stale-cached' }); });
        expect(result.current.translation).toBe('fresh');
    });
});
