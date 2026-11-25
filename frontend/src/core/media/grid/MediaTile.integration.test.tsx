import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { MediaTile, META_WAIT_MS } from './MediaTile';
import { resetMediaMetaForTests } from './mediaMeta';
import { resetLoadSchedulerForTests } from './loadScheduler';

/**
 * The real tile → meta store → scheduler → ready memory path (only `Image` and `fetch` are
 * stand-ins): what a user sees on a first open, a re-mount while scrolling and a reopen.
 */
class FakeImage {
    static all: FakeImage[] = [];
    decoding = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = '';
    resolve!: () => void;
    private promise = new Promise<void>((r) => { this.resolve = r; });
    constructor() { FakeImage.all.push(this); }
    decode() { return this.promise; }
}

const PIC = '/api/content/media/hinatazaka46/messages/m/picture/123.jpg';
const PLAIN = '/api/content/thumb/hinatazaka46/messages/m/picture/123.jpg?w=320';
const VERSIONED = `${PLAIN}&v=a1b2c3d4e5f6`;
let metaDelayMs = 0;
let fetchMock: ReturnType<typeof vi.fn>;

const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const decodeAll = async () => {
    await act(async () => { FakeImage.all.forEach((i) => i.resolve()); await vi.advanceTimersByTimeAsync(20); });
};

beforeEach(() => {
    vi.useFakeTimers();
    FakeImage.all = [];
    metaDelayMs = 0;
    resetMediaMetaForTests();
    resetLoadSchedulerForTests();
    vi.stubGlobal('Image', FakeImage);
    fetchMock = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((resolve) => {
        const { urls } = JSON.parse(init.body as string) as { urls: string[] };
        const items = Object.fromEntries(urls.map((u) => [u, {
            kind: 'picture', v: 'a1b2c3d4e5f6', color: 'teal', blur: null, w: 10, h: 10, poster: false,
        }]));
        setTimeout(() => resolve(new Response(JSON.stringify({ items }))), metaDelayMs);
    }));
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('MediaTile on the real scheduler and meta store', () => {
    it('first open with meta in time requests ?v; a re-mount is instant with no request', async () => {
        metaDelayMs = 30;
        const first = render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        await advance(60); // flush (16 ms) + the round trip, inside META_WAIT_MS
        expect(FakeImage.all.map((i) => i.src)).toEqual([VERSIONED]);
        await decodeAll();
        expect(first.container.querySelector('img[data-media-tile-image]')!.getAttribute('src')).toBe(VERSIONED);
        first.unmount();

        const again = render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        const img = again.container.querySelector('img[data-media-tile-image]') as HTMLImageElement;
        expect(img.getAttribute('src')).toBe(VERSIONED);
        expect(img.className).toContain('opacity-100');
        expect(again.container.querySelector('[data-skeleton]')).toBeNull();
        await advance(META_WAIT_MS * 2);
        expect(FakeImage.all).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('first open with late meta loads the plain thumbnail; a reopen reuses it with no request', async () => {
        metaDelayMs = 500;
        const first = render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        await advance(META_WAIT_MS);
        expect(FakeImage.all.map((i) => i.src)).toEqual([PLAIN]);
        await decodeAll();
        await advance(600); // meta (with v) lands after the image
        first.unmount();

        const reopen = render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        const img = reopen.container.querySelector('img[data-media-tile-image]') as HTMLImageElement;
        expect(img.getAttribute('src')).toBe(PLAIN);
        expect(img.className).toContain('opacity-100');
        expect(reopen.container.querySelector('[data-skeleton]')).toBeNull();
        await advance(META_WAIT_MS * 2);
        expect(FakeImage.all).toHaveLength(1);
    });

    it('falls back to the plain thumbnail when the meta batch fails', async () => {
        fetchMock.mockImplementation(async () => new Response('no', { status: 500 }));
        render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        await advance(40);
        expect(FakeImage.all.map((i) => i.src)).toEqual([PLAIN]);
    });
});
