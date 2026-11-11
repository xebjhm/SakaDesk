import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    MAX_IMAGE_INFLIGHT, isImageReady, resetLoadSchedulerForTests, scheduleImage, scheduleTask, setReadyCacheMaxForTests,
} from './loadScheduler';

/** A controllable stand-in for `Image`: the test resolves or rejects each decode. */
class FakeImage {
    static all: FakeImage[] = [];
    decoding = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private _src = '';
    srcHistory: string[] = [];
    resolve!: () => void;
    reject!: (e?: unknown) => void;
    decodePromise: Promise<void>;
    constructor() {
        this.decodePromise = new Promise<void>((res, rej) => { this.resolve = res; this.reject = rej; });
        FakeImage.all.push(this);
    }
    get src() { return this._src; }
    set src(v: string) { this._src = v; this.srcHistory.push(v); }
    decode() { return this.decodePromise; }
}
const running = () => FakeImage.all.filter(i => i.src !== '' && !(i as unknown as { done?: boolean }).done);
const bySrc = (src: string) => FakeImage.all.find(i => i.srcHistory[0] === src)!;
const tick = () => new Promise<void>(r => setTimeout(r, 0));

beforeEach(() => {
    FakeImage.all = [];
    resetLoadSchedulerForTests();
    vi.stubGlobal('Image', FakeImage);
});
afterEach(() => vi.unstubAllGlobals());

describe('loadScheduler', () => {
    it('keeps at most MAX_IMAGE_INFLIGHT loads running', async () => {
        const ready = vi.fn();
        for (let i = 0; i < 10; i += 1) scheduleImage(`/a/${i}`, 'visible', ready, vi.fn());
        expect(MAX_IMAGE_INFLIGHT).toBe(4);
        expect(FakeImage.all).toHaveLength(4);
        expect(FakeImage.all[0].decoding).toBe('async');
        bySrc('/a/0').resolve();
        await tick();
        expect(ready).toHaveBeenCalledTimes(1);
        expect(FakeImage.all).toHaveLength(5);
        expect(FakeImage.all[4].src).toBe('/a/4');
        expect(running().length).toBeLessThanOrEqual(5);
    });

    it('runs visible jobs before near ones', async () => {
        for (let i = 0; i < 4; i += 1) scheduleImage(`/busy/${i}`, 'visible', vi.fn(), vi.fn());
        scheduleImage('/near/1', 'near', vi.fn(), vi.fn());
        scheduleImage('/visible/1', 'visible', vi.fn(), vi.fn());
        bySrc('/busy/0').resolve();
        await tick();
        expect(FakeImage.all[4].src).toBe('/visible/1');
        bySrc('/busy/1').resolve();
        await tick();
        expect(FakeImage.all[5].src).toBe('/near/1');
    });

    it('moves a waiting job between queues with setPriority', async () => {
        for (let i = 0; i < 4; i += 1) scheduleImage(`/busy/${i}`, 'visible', vi.fn(), vi.fn());
        const near = scheduleImage('/near/1', 'near', vi.fn(), vi.fn());
        scheduleImage('/visible/1', 'visible', vi.fn(), vi.fn());
        near.setPriority('visible'); // joins the back of the visible queue
        const promoted = scheduleImage('/near/2', 'near', vi.fn(), vi.fn());
        promoted.setPriority('visible');
        scheduleImage('/visible/2', 'visible', vi.fn(), vi.fn()).setPriority('near');
        for (let i = 0; i < 4; i += 1) { bySrc(`/busy/${i}`).resolve(); await tick(); }
        expect(FakeImage.all.slice(4).map(i => i.src)).toEqual(['/visible/1', '/near/1', '/near/2', '/visible/2']);
    });

    it('cancel removes a waiting job and frees the slot of a running one', async () => {
        const ready0 = vi.fn();
        const tickets = Array.from({ length: 4 }, (_, i) => scheduleImage(`/busy/${i}`, 'visible', i === 0 ? ready0 : vi.fn(), vi.fn()));
        const waitingReady = vi.fn();
        const waiting = scheduleImage('/waiting', 'visible', waitingReady, vi.fn());
        scheduleImage('/next', 'visible', vi.fn(), vi.fn());
        waiting.cancel();
        tickets[0].cancel();
        expect(bySrc('/busy/0').src).toBe('');
        expect(FakeImage.all[4].src).toBe('/next');
        bySrc('/busy/0').resolve();
        await tick();
        expect(ready0).not.toHaveBeenCalled();
        expect(waitingReady).not.toHaveBeenCalled();
        expect(FakeImage.all.some(i => i.srcHistory[0] === '/waiting')).toBe(false);
    });

    it('calls onReady synchronously for a src decoded earlier this session', async () => {
        scheduleImage('/x', 'near', vi.fn(), vi.fn());
        bySrc('/x').resolve();
        await tick();
        expect(isImageReady('/x')).toBe(true);
        const ready = vi.fn();
        scheduleImage('/x', 'near', ready, vi.fn());
        expect(ready).toHaveBeenCalledTimes(1);
        expect(FakeImage.all).toHaveLength(1);
    });

    it('bounds the ready memory (LRU)', async () => {
        setReadyCacheMaxForTests(2);
        for (const s of ['/1', '/2', '/3']) {
            scheduleImage(s, 'visible', vi.fn(), vi.fn());
            bySrc(s).resolve();
            await tick();
        }
        expect(isImageReady('/1')).toBe(false);
        expect(isImageReady('/3')).toBe(true);
    });

    it('falls back to onload / onerror when decode rejects', async () => {
        const ready = vi.fn();
        const error = vi.fn();
        scheduleImage('/ok', 'visible', ready, vi.fn());
        scheduleImage('/bad', 'visible', vi.fn(), error);
        bySrc('/ok').reject(new Error('EncodingError'));
        bySrc('/bad').reject(new Error('EncodingError'));
        await tick();
        expect(ready).not.toHaveBeenCalled();
        bySrc('/ok').onload?.();
        bySrc('/bad').onerror?.();
        expect(ready).toHaveBeenCalledTimes(1);
        expect(error).toHaveBeenCalledTimes(1);
        expect(isImageReady('/bad')).toBe(false);
        // onerror first, then the rejection
        const late = vi.fn();
        scheduleImage('/late', 'visible', vi.fn(), late);
        bySrc('/late').onerror?.();
        bySrc('/late').reject(new Error('x'));
        await tick();
        expect(late).toHaveBeenCalledTimes(1);
    });

    it('shares the slots with tasks (poster capture)', async () => {
        let finish!: () => void;
        const run = vi.fn(() => new Promise<void>(r => { finish = r; }));
        for (let i = 0; i < 4; i += 1) scheduleImage(`/busy/${i}`, 'visible', vi.fn(), vi.fn());
        scheduleTask('visible', run);
        expect(run).not.toHaveBeenCalled();
        bySrc('/busy/0').resolve();
        await tick();
        expect(run).toHaveBeenCalledTimes(1);
        scheduleImage('/after', 'visible', vi.fn(), vi.fn());
        bySrc('/busy/1').resolve();
        await tick();
        expect(FakeImage.all.map(i => i.srcHistory[0])).toContain('/after');
        finish();
        await tick();
        const cancelled = vi.fn(() => Promise.resolve());
        const t = scheduleTask('near', cancelled);
        t.cancel();
        await tick();
        // A running task whose promise rejects still frees its slot.
        scheduleTask('visible', () => Promise.reject(new Error('x')));
        await tick();
        for (let i = 0; i < 4; i += 1) scheduleImage(`/more/${i}`, 'visible', vi.fn(), vi.fn());
        expect(FakeImage.all.filter(i => i.srcHistory[0]?.startsWith('/more/')).length).toBeGreaterThan(0);
    });
});
