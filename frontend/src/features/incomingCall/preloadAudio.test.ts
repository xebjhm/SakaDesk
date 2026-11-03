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
    load() {}
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
        const p = preloadAudio('/slow.m4a', 1000);
        const assertion = expect(p).rejects.toThrow('media_unavailable');
        await vi.advanceTimersByTimeAsync(1000);
        await assertion;
    });
});
