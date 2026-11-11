import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import i18n from '../../../i18n';
import { buildMediaUrl } from '../../../features/messages/mediaUrl';
import type { MediaMeta } from './mediaMeta';
import type { LoadPriority } from './loadScheduler';

// --- controllable stand-ins for the tile's collaborators ------------------------------------
const metaState: { value: MediaMeta | null | undefined } = { value: undefined };
const invalidate = vi.fn();
vi.mock('./mediaMeta', () => ({
    useMediaMeta: () => metaState.value,
    invalidateMediaMeta: (u: string) => invalidate(u),
    isMediaRouteUrl: (u: unknown) => typeof u === 'string' && u.startsWith('/api/content/media/'),
}));

interface Job { src: string; priority: LoadPriority; onReady: () => void; onError: () => void; setPriority: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }
const jobs: Job[] = [];
const ready = new Set<string>();
vi.mock('./loadScheduler', () => ({
    scheduleImage: (src: string, priority: LoadPriority, onReady: () => void, onError: () => void) => {
        const job: Job = { src, priority, onReady, onError, setPriority: vi.fn(), cancel: vi.fn() };
        jobs.push(job);
        return { setPriority: job.setPriority, cancel: job.cancel };
    },
    isImageReady: (src: string) => ready.has(src),
    forgetImage: (src: string) => { ready.delete(src); },
}));

const visibility: { value: LoadPriority; known: boolean } = { value: 'visible', known: true };
vi.mock('./useTileVisibility', () => ({
    useTileVisibilityState: () => ({ priority: visibility.value, known: visibility.known }),
}));

const capture = vi.fn<(url: string, signal?: AbortSignal) => Promise<boolean>>();
vi.mock('./posterCapture', () => ({ posterCapture: { request: (u: string, s?: AbortSignal) => capture(u, s) } }));

import { MediaTile, META_WAIT_MS } from './MediaTile';
import { MediaGridContext, type MediaGridTileReporter } from './gridContext';

const PIC = '/api/content/media/hinatazaka46/messages/m/picture/123.jpg';
const VID = '/api/content/media/hinatazaka46/messages/m/video/124.mp4';
const THUMB = (w: number, v?: string) => `/api/content/thumb/hinatazaka46/messages/m/picture/123.jpg?w=${w}${v ? `&v=${v}` : ''}`;
const meta = (over: Partial<MediaMeta> = {}): MediaMeta => ({
    kind: 'picture', v: 'a1b2c3d4e5f6', color: 'teal', blur: 'data:image/webp;base64,AAAA', w: 1440, h: 1080, poster: false, ...over,
});
const last = () => jobs[jobs.length - 1];
const frame = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(20); }); };

beforeEach(() => {
    vi.useFakeTimers();
    jobs.length = 0;
    ready.clear();
    invalidate.mockClear();
    capture.mockReset();
    metaState.value = meta();
    visibility.value = 'visible';
    visibility.known = true;
});
afterEach(() => vi.useRealTimers());

describe('MediaTile: picture', () => {
    it('paints the meta colour through style before the image loads', () => {
        const { container } = render(<MediaTile url={PIC} kind="picture" cssPx={200} testId="tile" />);
        const skeleton = container.querySelector('[data-skeleton]') as HTMLElement;
        expect(skeleton.style.backgroundColor).toBe('teal');
        expect(skeleton.className).toContain('animate-pulse');
        expect(skeleton.className).toContain('motion-reduce:animate-none');
        expect(skeleton.className).not.toContain('bg-sunken');
        expect(screen.getByTestId('tile').querySelector('img:not([aria-hidden])')).toBeNull();
    });

    it('uses the sunken skeleton when there is no colour', () => {
        metaState.value = meta({ color: null, blur: null });
        const { container } = render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        expect(container.querySelector('[data-skeleton]')!.className).toContain('bg-sunken');
        expect(container.querySelector('img')).toBeNull();
    });

    it('shows the blur preview as an aria-hidden image', () => {
        const { container } = render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        const blur = container.querySelector('img[aria-hidden="true"]') as HTMLImageElement;
        expect(blur.getAttribute('src')).toBe('data:image/webp;base64,AAAA');
        expect(blur.className).toContain('blur-placeholder');
        expect(blur.className).toContain('scale-110');
        expect(blur.className).toContain('object-cover');
    });

    it('schedules the versioned thumbnail at the width for the drawn size', () => {
        render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        expect(last().src).toBe(THUMB(320, 'a1b2c3d4e5f6'));
        expect(last().priority).toBe('visible');
    });

    it('caps grid tiles at 480 and lets large tiles use 640', () => {
        const { unmount } = render(<MediaTile url={PIC} kind="picture" cssPx={600} />);
        expect(last().src).toBe(THUMB(480, 'a1b2c3d4e5f6'));
        unmount();
        render(<MediaTile url={PIC} kind="picture" cssPx={600} large />);
        expect(last().src).toBe(THUMB(640, 'a1b2c3d4e5f6'));
    });

    it('fades the image in once it is ready', async () => {
        const { container } = render(<MediaTile url={PIC} kind="picture" cssPx={200} testId="tile" />);
        act(() => last().onReady());
        const img = screen.getByTestId('tile').querySelector('img[data-media-tile-image]') as HTMLImageElement;
        expect(img.getAttribute('src')).toBe(THUMB(320, 'a1b2c3d4e5f6'));
        expect(img.getAttribute('alt')).toBe('');
        expect(img.className).toContain('opacity-0');
        expect(img.className).toContain('transition-opacity duration-base ease-standard motion-reduce:transition-none');
        await frame();
        expect(img.className).toContain('opacity-100');
        expect(img.className).not.toContain('opacity-0');
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
        expect(container.querySelector('[data-skeleton]')).toBeNull();
    });

    it('shows a ?v src decoded earlier this session at once, without a fade', () => {
        ready.add(THUMB(320, 'a1b2c3d4e5f6'));
        render(<MediaTile url={PIC} kind="picture" cssPx={200} testId="tile" />);
        const img = screen.getByTestId('tile').querySelector('img[data-media-tile-image]') as HTMLImageElement;
        expect(img.className).toContain('opacity-100');
        expect(jobs).toHaveLength(0);
    });

    it('falls back ?v → no v → full file → onFail, then shows a quiet retry state', () => {
        const onFail = vi.fn();
        render(<MediaTile url={PIC} kind="picture" cssPx={200} onFail={onFail} testId="tile" retryButton />);
        act(() => last().onError());
        expect(last().src).toBe(THUMB(320));
        act(() => last().onError());
        expect(last().src).toBe(PIC);
        expect(onFail).not.toHaveBeenCalled();
        act(() => last().onError());
        expect(onFail).toHaveBeenCalledTimes(1);
        const tile = screen.getByTestId('tile');
        expect(tile.textContent).toContain(i18n.t('loading.error'));
        expect(tile.querySelector('[data-skeleton]')).toBeNull();
        expect(tile.getAttribute('data-state')).toBe('failed');
        // Retry starts the chain again.
        const count = jobs.length;
        fireEvent.click(screen.getByRole('button', { name: i18n.t('loading.retry') }));
        expect(jobs).toHaveLength(count + 1);
        expect(last().src).toBe(THUMB(320, 'a1b2c3d4e5f6'));
    });

    it('has no retry button unless asked (callers wrap tiles in their own button) and retries on revisit', () => {
        const { rerender } = render(<MediaTile url={PIC} kind="picture" cssPx={200} testId="tile" />);
        for (let i = 0; i < 3; i += 1) act(() => last().onError());
        expect(screen.queryByRole('button')).toBeNull();
        const count = jobs.length;
        visibility.value = 'near';
        rerender(<MediaTile url={PIC} kind="picture" cssPx={200} testId="tile" />);
        visibility.value = 'visible';
        rerender(<MediaTile url={PIC} kind="picture" cssPx={200} testId="tile" />);
        expect(jobs).toHaveLength(count + 1);
    });

    it('reports each state change, including a silent automatic retry', () => {
        const onStateChange = vi.fn();
        const { rerender } = render(<MediaTile url={PIC} kind="picture" cssPx={200} onStateChange={onStateChange} />);
        expect(onStateChange).toHaveBeenLastCalledWith('loading');
        for (let i = 0; i < 3; i += 1) act(() => last().onError());
        expect(onStateChange).toHaveBeenLastCalledWith('failed');
        visibility.value = 'near';
        rerender(<MediaTile url={PIC} kind="picture" cssPx={200} onStateChange={onStateChange} />);
        visibility.value = 'visible';
        rerender(<MediaTile url={PIC} kind="picture" cssPx={200} onStateChange={onStateChange} />);
        expect(onStateChange).toHaveBeenLastCalledWith('loading');
        act(() => last().onReady());
        expect(onStateChange).toHaveBeenLastCalledWith('ready');
    });

    it('reports the eager tile\'s state too', () => {
        const onStateChange = vi.fn();
        const { container } = render(<MediaTile url={PIC} kind="picture" cssPx={200} eager onStateChange={onStateChange} />);
        expect(onStateChange).toHaveBeenLastCalledWith('ready');
        fireEvent.error(container.querySelector('img[data-media-tile-image]')!);
        fireEvent.error(container.querySelector('img[data-media-tile-image]')!);
        expect(onStateChange).toHaveBeenLastCalledWith('failed');
    });

    it('re-mounts instantly on the plain src a first open decoded, even once meta (with v) is known', () => {
        ready.add(THUMB(320)); // the first open loaded the plain thumbnail before meta arrived
        const { container } = render(<MediaTile url={PIC} kind="picture" cssPx={200} testId="tile" />);
        const img = screen.getByTestId('tile').querySelector('img[data-media-tile-image]') as HTMLImageElement;
        expect(img.getAttribute('src')).toBe(THUMB(320));
        expect(img.className).toContain('opacity-100');
        expect(container.querySelector('[data-skeleton]')).toBeNull();
        expect(jobs).toHaveLength(0);
    });

    it('re-mounts instantly on the plain src while meta is still unknown', () => {
        metaState.value = undefined;
        ready.add(THUMB(320));
        const { container } = render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        expect(container.querySelector('img[data-media-tile-image]')!.className).toContain('opacity-100');
        expect(container.querySelector('[data-skeleton]')).toBeNull();
        expect(jobs).toHaveLength(0);
    });

    it('waits a bounded time for meta, then starts the plain thumbnail', async () => {
        metaState.value = undefined;
        const { container } = render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        expect(jobs).toHaveLength(0);
        expect(container.querySelector('[data-skeleton]')).not.toBeNull(); // the placeholder shows meanwhile
        await act(async () => { await vi.advanceTimersByTimeAsync(META_WAIT_MS - 1); });
        expect(jobs).toHaveLength(0);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(last().src).toBe(THUMB(320));
    });

    it('requests the ?v thumbnail on a first open when meta arrives in time', async () => {
        metaState.value = undefined;
        const { rerender } = render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(40); });
        expect(jobs).toHaveLength(0);
        metaState.value = meta();
        rerender(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        expect(jobs).toHaveLength(1);
        expect(last().src).toBe(THUMB(320, 'a1b2c3d4e5f6'));
        await act(async () => { await vi.advanceTimersByTimeAsync(META_WAIT_MS); });
        expect(jobs).toHaveLength(1);
    });

    it('takes no slot before its first visibility report', () => {
        visibility.known = false;
        const { rerender } = render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        expect(jobs).toHaveLength(0);
        visibility.known = true;
        visibility.value = 'near';
        rerender(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        expect(last().priority).toBe('near');
    });

    it('hands onFail a retry that restarts the chain (for galleries that wrap tiles in a button)', () => {
        let retry: (() => void) | undefined;
        render(<MediaTile url={PIC} kind="picture" cssPx={200} onFail={(r) => { retry = r; }} testId="tile" />);
        for (let i = 0; i < 3; i += 1) act(() => last().onError());
        expect(screen.getByTestId('tile').getAttribute('data-state')).toBe('failed');
        act(() => retry!());
        expect(last().src).toBe(THUMB(320, 'a1b2c3d4e5f6'));
        expect(screen.getByTestId('tile').getAttribute('data-state')).toBe('loading');
    });

    it('forgets a decoded src whose rendered image failed, then falls back', () => {
        ready.add(THUMB(320, 'a1b2c3d4e5f6'));
        const { container } = render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        fireEvent.error(container.querySelector('img[data-media-tile-image]')!);
        expect(ready.has(THUMB(320, 'a1b2c3d4e5f6'))).toBe(false);
        expect(last().src).toBe(THUMB(320));
    });

    it('loads the plain thumbnail when meta failed (null)', () => {
        metaState.value = null;
        render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        expect(last().src).toBe(THUMB(320));
    });

    it('moves its load between queues as it scrolls', () => {
        const { rerender } = render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        visibility.value = 'near';
        rerender(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        expect(last().setPriority).toHaveBeenCalledWith('near');
    });

    it('cancels its load on unmount', () => {
        const { unmount } = render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        const job = last();
        unmount();
        expect(job.cancel).toHaveBeenCalled();
    });

    it('encodes CJK and emoji paths', () => {
        const url = buildMediaUrl('hinatazaka46', 'messages/62 石森 璃花/🌸 写真.jpg');
        metaState.value = meta({ v: 'abc' });
        render(<MediaTile url={url} kind="picture" cssPx={100} />);
        expect(last().src).toBe(
            `/api/content/thumb/hinatazaka46/messages/62%20${encodeURIComponent('石森')}%20${encodeURIComponent('璃花')}/${encodeURIComponent('🌸')}%20${encodeURIComponent('写真')}.jpg?w=160&v=abc`,
        );
    });

    it('renders a plain eager <img> at once, with the same fallbacks', () => {
        const onFail = vi.fn();
        const { container } = render(<MediaTile url={PIC} kind="picture" cssPx={200} eager onFail={onFail} />);
        const img = container.querySelector('img[data-media-tile-image]') as HTMLImageElement;
        expect(img.getAttribute('loading')).toBe('eager');
        expect(img.getAttribute('src')).toBe(THUMB(320));
        expect(jobs).toHaveLength(0);
        fireEvent.error(img);
        expect(container.querySelector('img[data-media-tile-image]')!.getAttribute('src')).toBe(PIC);
        fireEvent.error(container.querySelector('img[data-media-tile-image]')!);
        expect(onFail).toHaveBeenCalledTimes(1);
    });

    it('under reduced motion shows a compact spinner after reveal while waiting', async () => {
        const { container } = render(<MediaTile url={PIC} kind="picture" cssPx={200} />);
        expect(container.querySelector('[data-spinner]')).toBeNull();
        await act(async () => { await vi.advanceTimersByTimeAsync(250); });
        const spinner = container.querySelector('[data-spinner]') as HTMLElement;
        expect(spinner).not.toBeNull();
        expect(spinner.closest('.hidden')!.className).toContain('motion-reduce:inline-flex');
        expect(spinner.getAttribute('role')).toBe('status');
        act(() => last().onReady());
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });
        expect(container.querySelector('[data-spinner]')).toBeNull();
    });

    it('reports its first visible ready to the grid', () => {
        const reporter: MediaGridTileReporter = { tileReady: vi.fn(), tileVisible: vi.fn() };
        render(
            <MediaGridContext.Provider value={reporter}>
                <MediaTile url={PIC} kind="picture" cssPx={200} />
            </MediaGridContext.Provider>,
        );
        expect(reporter.tileVisible).toHaveBeenCalledWith(1);
        act(() => last().onReady());
        expect(reporter.tileReady).toHaveBeenCalledTimes(1);
    });

    it('shows the quiet failed state for a picture without a URL', () => {
        render(<MediaTile url={null} kind="picture" cssPx={200} testId="tile" />);
        expect(screen.getByTestId('tile').getAttribute('data-state')).toBe('failed');
        expect(jobs).toHaveLength(0);
    });
});

describe('MediaTile: video', () => {
    const VTHUMB = (v?: string) => `/api/content/thumb/hinatazaka46/messages/m/video/124.mp4?w=320${v ? `&v=${v}` : ''}`;

    it('loads a ready poster through the thumbnail route', () => {
        metaState.value = meta({ kind: 'video', poster: true });
        const { container } = render(<MediaTile url={VID} kind="video" cssPx={200} />);
        expect(last().src).toBe(VTHUMB('a1b2c3d4e5f6'));
        expect(container.querySelector('video')).toBeNull();
    });

    it('shows the film tile and captures only after 300 ms visible', async () => {
        metaState.value = meta({ kind: 'video', poster: false });
        capture.mockResolvedValue(true);
        const { container } = render(<MediaTile url={VID} kind="video" cssPx={200} testId="tile" />);
        expect(jobs).toHaveLength(0);
        expect(screen.getByTestId('media-tile-film')).toBeInTheDocument();
        await act(async () => { await vi.advanceTimersByTimeAsync(299); });
        expect(capture).not.toHaveBeenCalled();
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(capture).toHaveBeenCalledWith(VID, expect.any(AbortSignal));
        await act(async () => { await Promise.resolve(); });
        expect(invalidate).toHaveBeenCalledWith(VID);
        expect(container.querySelector('video')).toBeNull();
    });

    it('never captures a tile that is only near the viewport, or when capture is off', async () => {
        metaState.value = meta({ kind: 'video', poster: false });
        visibility.value = 'near';
        const { unmount } = render(<MediaTile url={VID} kind="video" cssPx={200} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        expect(capture).not.toHaveBeenCalled();
        unmount();
        visibility.value = 'visible';
        render(<MediaTile url={VID} kind="video" cssPx={200} capturePoster={false} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        expect(capture).not.toHaveBeenCalled();
    });

    it('aborts a pending capture when the tile scrolls away', async () => {
        metaState.value = meta({ kind: 'video', poster: false });
        let signal: AbortSignal | undefined;
        capture.mockImplementation((_u, s) => { signal = s; return new Promise(() => {}); });
        const { rerender } = render(<MediaTile url={VID} kind="video" cssPx={200} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        visibility.value = 'near';
        rerender(<MediaTile url={VID} kind="video" cssPx={200} />);
        expect(signal?.aborted).toBe(true);
    });

    it('captures when the poster thumbnail 404s even though meta said ready', async () => {
        metaState.value = meta({ kind: 'video', poster: true });
        capture.mockResolvedValue(false);
        render(<MediaTile url={VID} kind="video" cssPx={200} testId="tile" />);
        act(() => last().onError());
        expect(last().src).toBe(VTHUMB());
        act(() => last().onError());
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        expect(capture).toHaveBeenCalledTimes(1);
        await act(async () => { await Promise.resolve(); });
        expect(screen.getByTestId('media-tile-film')).toBeInTheDocument();
        expect(invalidate).not.toHaveBeenCalled();
    });

    it('reloads the poster after a successful capture', async () => {
        metaState.value = meta({ kind: 'video', poster: false });
        capture.mockResolvedValue(true);
        const { rerender } = render(<MediaTile url={VID} kind="video" cssPx={200} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        metaState.value = meta({ kind: 'video', poster: true, v: 'fresh' });
        rerender(<MediaTile url={VID} kind="video" cssPx={200} />);
        expect(last().src).toBe(VTHUMB('fresh'));
    });

    it('tries the plain poster thumbnail when meta is unknown, never the video file', async () => {
        metaState.value = undefined;
        render(<MediaTile url={VID} kind="video" cssPx={200} testId="tile" />);
        await act(async () => { await vi.advanceTimersByTimeAsync(META_WAIT_MS); });
        expect(last().src).toBe(VTHUMB());
        act(() => last().onError());
        expect(jobs.every(j => !j.src.endsWith('.mp4'))).toBe(true);
        expect(screen.getByTestId('media-tile-film')).toBeInTheDocument();
    });

    it('never loads a video outside the media route as an image', () => {
        render(<MediaTile url="/api/blogs/video?x=1.mp4" kind="video" cssPx={200} />);
        expect(jobs).toHaveLength(0);
        expect(screen.getByTestId('media-tile-film')).toBeInTheDocument();
    });

    it('loads the plain poster when the meta batch failed (null)', () => {
        metaState.value = null;
        render(<MediaTile url={VID} kind="video" cssPx={200} />);
        expect(last().src).toBe(VTHUMB());
    });

    it('shows the film tile for a video without a URL', () => {
        render(<MediaTile url={undefined} kind="video" cssPx={200} />);
        expect(screen.getByTestId('media-tile-film')).toBeInTheDocument();
    });
});
