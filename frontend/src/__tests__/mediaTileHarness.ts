/**
 * A test harness for surfaces that render the shared `MediaTile` (media pipeline, 0.5.0) on the
 * real meta store and load scheduler: `Image` is a stand-in whose loads the test settles, and
 * `POST /api/media/meta` answers through MSW from `metaFor` while recording each batch.
 * Call `installMediaTileHarness()` in `beforeEach` and `vi.unstubAllGlobals()` in `afterEach`.
 */
import { vi } from 'vitest';
import { act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import { resetMediaMetaForTests, type MediaMeta } from '../core/media/grid/mediaMeta';
import { resetLoadSchedulerForTests } from '../core/media/grid/loadScheduler';
import { resetPosterCaptureForTests } from '../core/media/grid/posterCapture';

/** An `Image` without `decode`: the scheduler settles on `load` / `error`, which the test fires. */
export class FakeImage {
    static all: FakeImage[] = [];
    decoding = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    settled = false;
    src = '';
    constructor() { FakeImage.all.push(this); }
}

export interface MediaTileHarness {
    /** Every src the scheduler asked an `Image` for, in order. */
    requested(): string[];
    /** The URL lists of each `POST /api/media/meta` batch, in order. */
    metaBatches: string[][];
    /** Settle the pending loads (those whose src matches `match`, else all) as loaded. */
    load(match?: string | RegExp): Promise<void>;
    /** Settle the pending loads (those whose src matches `match`, else all) as failed. */
    fail(match?: string | RegExp): Promise<void>;
}

const matches = (src: string, match: string | RegExp | undefined) =>
    match === undefined || (typeof match === 'string' ? src.includes(match) : match.test(src));

export function installMediaTileHarness(metaFor: (url: string) => MediaMeta | null = () => null): MediaTileHarness {
    FakeImage.all = [];
    resetMediaMetaForTests();
    resetLoadSchedulerForTests();
    resetPosterCaptureForTests();
    vi.stubGlobal('Image', FakeImage);
    const metaBatches: string[][] = [];
    server.use(http.post('/api/media/meta', async ({ request }) => {
        const { urls } = (await request.json()) as { urls: string[] };
        metaBatches.push(urls);
        return HttpResponse.json({ items: Object.fromEntries(urls.map((u) => [u, metaFor(u)])) });
    }));
    const settle = async (ok: boolean, match: string | RegExp | undefined) => {
        await act(async () => {
            for (const img of FakeImage.all) {
                if (img.settled || !img.src || !matches(img.src, match)) continue;
                img.settled = true;
                if (ok) img.onload?.(); else img.onerror?.();
            }
            await Promise.resolve();
        });
    };
    return {
        requested: () => FakeImage.all.map((i) => i.src).filter(Boolean),
        metaBatches,
        load: (match) => settle(true, match),
        fail: (match) => settle(false, match),
    };
}

/** A ready meta row for a picture (`v`, placeholder colour) or a video (with `poster`). */
export function readyMeta(over: Partial<MediaMeta> = {}): MediaMeta {
    return { kind: 'picture', v: 'a1b2c3d4e5f6', color: 'teal', blur: null, w: 1440, h: 1080, poster: false, ...over };
}
