import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppStore } from '../store/appStore';
import { useOshiMirror } from './useOshiMirror';

describe('useOshiMirror', () => {
    beforeEach(() => { useAppStore.setState({ favorites: {} }); vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response)); });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('posts the favorites map, debounced', async () => {
        renderHook(() => useOshiMirror());
        act(() => { useAppStore.getState().toggleFavorite('hinatazaka46', '12'); });
        act(() => { useAppStore.getState().toggleFavorite('hinatazaka46', '15'); });
        await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
        const posts = vi.mocked(fetch).mock.calls.filter(([u, i]) => u === '/api/settings' && (i as RequestInit)?.method === 'POST');
        expect(posts.length).toBe(1);
        const body = JSON.parse((posts[0][1] as RequestInit).body as string);
        expect(body.oshi_members.hinatazaka46).toEqual(expect.arrayContaining(['12', '15']));
    });

    it('skips the initial post when favorites are empty', async () => {
        renderHook(() => useOshiMirror());
        await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('posts the initial value when favorites are non-empty', async () => {
        useAppStore.setState({ favorites: { hinatazaka46: ['12'] } });
        renderHook(() => useOshiMirror());
        await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
        const posts = vi.mocked(fetch).mock.calls.filter(([u]) => u === '/api/settings');
        expect(posts.length).toBe(1);
    });

    it('still posts an emptied list after a real toggle', async () => {
        useAppStore.setState({ favorites: { hinatazaka46: ['12'] } });
        renderHook(() => useOshiMirror());
        await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
        vi.mocked(fetch).mockClear();
        act(() => { useAppStore.getState().toggleFavorite('hinatazaka46', '12'); });
        await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
        const posts = vi.mocked(fetch).mock.calls.filter(([u]) => u === '/api/settings');
        expect(posts.length).toBe(1);
        expect(JSON.parse((posts[0][1] as RequestInit).body as string).oshi_members.hinatazaka46).toEqual([]);
    });

    it('does not post while disabled (pre-hydration)', async () => {
        renderHook(() => useOshiMirror(false));
        act(() => { useAppStore.getState().toggleFavorite('hinatazaka46', '20'); });
        await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('warns and logs on failure', async () => {
        vi.mocked(fetch).mockRejectedValue(new TypeError('net'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        renderHook(() => useOshiMirror());
        act(() => { useAppStore.getState().toggleFavorite('hinatazaka46', '30'); });
        await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
        expect(warn).toHaveBeenCalled();
        const logged = vi.mocked(fetch).mock.calls.some(([u]) => u === '/api/client-log');
        expect(logged).toBe(true);
        warn.mockRestore();
    });
});
