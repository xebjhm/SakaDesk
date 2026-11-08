import { describe, it, expect, vi, afterEach } from 'vitest';
import { preloadAudio } from './preloadAudio';

class FakeAudio extends EventTarget {
    static last: FakeAudio | null = null;
    preload = '';
    private _src = '';
    constructor() { super(); FakeAudio.last = this; }
    get src() { return this._src; }
    set src(v: string) { this._src = v; }
    removeAttribute() { this._src = ''; }
    loadCalls = 0;
    load() { this.loadCalls += 1; }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('preloadAudio', () => {
    it('resolves on canplay and sets src', async () => {
        vi.stubGlobal('Audio', FakeAudio);
        const p = preloadAudio('/a.m4a');
        expect(FakeAudio.last?.src).toBe('/a.m4a');
        FakeAudio.last!.dispatchEvent(new Event('canplay'));
        await expect(p).resolves.toBeUndefined();
    });

    it('rejects on error', async () => {
        vi.stubGlobal('Audio', FakeAudio);
        const p = preloadAudio('/missing.m4a');
        FakeAudio.last!.dispatchEvent(new Event('error'));
        await expect(p).rejects.toThrow('media_unavailable');
    });

    it('rejects after the timeout when nothing happens', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('Audio', FakeAudio);
        const p = preloadAudio('/slow.m4a', undefined, 1000);
        const assertion = expect(p).rejects.toThrow('media_unavailable');
        await vi.advanceTimersByTimeAsync(1000);
        await assertion;
    });

    it('cancel via the signal rejects, clears src, reloads and drops the listeners', async () => {
        vi.stubGlobal('Audio', FakeAudio);
        const ctrl = new AbortController();
        const p = preloadAudio('/a.m4a', ctrl.signal);
        const audio = FakeAudio.last!;
        const assertion = expect(p).rejects.toThrow('aborted');
        ctrl.abort();
        await assertion;
        expect(audio.src).toBe('');
        expect(audio.loadCalls).toBe(1);
        // listeners are gone: a late event neither throws nor loads again
        audio.dispatchEvent(new Event('canplay'));
        audio.dispatchEvent(new Event('error'));
        expect(audio.loadCalls).toBe(1);
    });

    it('cancel clears the timeout', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('Audio', FakeAudio);
        const ctrl = new AbortController();
        const p = preloadAudio('/a.m4a', ctrl.signal, 1000);
        const assertion = expect(p).rejects.toThrow('aborted');
        ctrl.abort();
        await assertion;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects immediately for an already-aborted signal without touching the network', async () => {
        vi.stubGlobal('Audio', FakeAudio);
        FakeAudio.last = null;
        const ctrl = new AbortController();
        ctrl.abort();
        await expect(preloadAudio('/a.m4a', ctrl.signal)).rejects.toThrow('aborted');
        expect(FakeAudio.last).toBeNull();
    });

    it('releases the detached element once it can play (no lingering download)', async () => {
        vi.stubGlobal('Audio', FakeAudio);
        const p = preloadAudio('/a.m4a');
        const audio = FakeAudio.last!;
        audio.dispatchEvent(new Event('canplay'));
        await expect(p).resolves.toBeUndefined();
        expect(audio.src).toBe('');
        expect(audio.loadCalls).toBe(1);
    });

    it('aborting after it already resolved does nothing more', async () => {
        vi.stubGlobal('Audio', FakeAudio);
        const ctrl = new AbortController();
        const p = preloadAudio('/a.m4a', ctrl.signal);
        const audio = FakeAudio.last!;
        audio.dispatchEvent(new Event('canplay'));
        await p;
        ctrl.abort();
        expect(audio.src).toBe('');
        expect(audio.loadCalls).toBe(1);
    });
});
