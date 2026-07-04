import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMessageTranslation, clearTranslationCache } from './useMessageTranslation';

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

// The shared test setup mocks localStorage with inert vi.fn()s; back them with a
// real in-memory store so cache read/write/enumerate behaves like the browser.
const store = new Map<string, string>();

describe('useMessageTranslation', () => {
    beforeEach(() => {
        store.clear();
        const ls = window.localStorage as unknown as Record<string, ReturnType<typeof vi.fn>>;
        ls.getItem.mockImplementation((k: string) => (store.has(k) ? store.get(k)! : null));
        ls.setItem.mockImplementation((k: string, v: string) => { store.set(k, String(v)); });
        ls.removeItem.mockImplementation((k: string) => { store.delete(k); });
        ls.clear.mockImplementation(() => { store.clear(); });
        ls.key.mockImplementation((i: number) => Array.from(store.keys())[i] ?? null);
        Object.defineProperty(window.localStorage, 'length', {
            get: () => store.size,
            configurable: true,
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('lazy-inits from cache and trigger() skips the API on a cache hit', async () => {
        localStorage.setItem(KEY, 'cached-en');
        const fetchMock = mockFetchOk('should-not-be-used');

        const { result } = renderHook(() => useMessageTranslation(baseParams));
        expect(result.current.translation).toBe('cached-en');
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
        expect(localStorage.getItem(KEY)).toBe('fresh-en');
    });

    it('retrigger() clears the cache and refetches even when cached', async () => {
        localStorage.setItem(KEY, 'stale-en');
        const fetchMock = mockFetchOk('regenerated-en');
        const { result } = renderHook(() => useMessageTranslation(baseParams));

        await act(async () => { await result.current.retrigger(); });

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(result.current.translation).toBe('regenerated-en');
        expect(localStorage.getItem(KEY)).toBe('regenerated-en');
    });

    it('re-syncs from the new key when the target language changes', () => {
        localStorage.setItem('translation:message:500:ja', 'こんにちは-ja');
        mockFetchOk('unused');

        const { result, rerender } = renderHook(
            (props) => useMessageTranslation(props),
            { initialProps: baseParams }
        );
        expect(result.current.translation).toBeNull(); // no 'en' cache

        rerender({ ...baseParams, targetLanguage: 'ja' });
        expect(result.current.translation).toBe('こんにちは-ja');
        expect(result.current.state).toBe('done');
    });

    it('clearTranslationCache removes only translation: entries', () => {
        localStorage.setItem(KEY, 'x');
        localStorage.setItem('translation:message:1:ja', 'y');
        localStorage.setItem('unrelated', 'keep');

        clearTranslationCache();

        expect(localStorage.getItem(KEY)).toBeNull();
        expect(localStorage.getItem('translation:message:1:ja')).toBeNull();
        expect(localStorage.getItem('unrelated')).toBe('keep');
    });
});
