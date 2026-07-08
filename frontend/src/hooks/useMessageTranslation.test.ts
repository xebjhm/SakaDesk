import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMessageTranslation, clearTranslationCache } from './useMessageTranslation';
import { persisted } from '../core/persistence/persisted';
import * as appStateApi from '../core/persistence/appStateApi';

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
    });
});
