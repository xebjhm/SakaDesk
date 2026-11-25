import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../../i18n';
import { MAX_AVATAR_BYTES, ShareDialog } from './ShareDialog';
import { daisukiData, message, payload, s02, s12 } from '../__fixtures__/payload';
import { recordingCanvas } from '../__fixtures__/recordingCanvas';
import type { RecapPayload, RecapSlide } from '../api';

vi.mock('../../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../../utils/clientLog';

vi.mock('./sharePhotos', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./sharePhotos')>();
    return { ...actual, loadShareAssets: vi.fn(async () => ({ photos: [], months: [], skipped: 1 })) };
});

vi.mock('./shareExport', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./shareExport')>();
    return {
        ...actual,
        videoSupport: vi.fn(() => ({ supported: false, reason: 'no_media_recorder' })),
        ensureShareFonts: vi.fn(async () => null),
        renderGifFrames: vi.fn(async () => ({ frames: ['AAAA'], durations: [8000] })),
        postShareGif: vi.fn(async () => ({ outcome: 'handed_off' })),
        recordVideo: vi.fn(async () => ({ blob: new Blob(['v'], { type: 'video/webm' }), kind: 'webm' })),
        saveShareBlob: vi.fn(async () => ({ outcome: 'handed_off' })),
    };
});
import { ensureShareFonts, postShareGif, recordVideo, renderGifFrames, saveShareBlob, videoSupport } from './shareExport';
import { ShareCancelledError, ShareSaveError } from './shareExport';
import { loadShareAssets } from './sharePhotos';

vi.mock('../posterImage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../posterImage')>();
    return { ...actual, canvasToPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) };
});

const shareLogs = () => vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'recap_share').map(([, f]) => f);

const recap = (): RecapPayload => payload({
    slides: [
        { ...s02, data: { ...(s02.data as object), last: message(8, '%%%、また明日ね') } } as RecapSlide,
        { key: 's11_daisuki', fallback: null, data: daisukiData() },
        s12,
    ],
});

const open = (r: RecapPayload = recap(), onClose = vi.fn()) =>
    render(<ShareDialog isOpen recap={r} nickname="ゆき" onClose={onClose} />);

let getContext: ReturnType<typeof vi.spyOn>;
beforeAll(async () => { await i18n.changeLanguage('ja'); });
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    vi.mocked(postShareGif).mockClear();
    vi.mocked(saveShareBlob).mockClear();
    vi.mocked(recordVideo).mockClear();
    vi.mocked(renderGifFrames).mockClear();
    vi.mocked(videoSupport).mockReturnValue({ supported: false, reason: 'no_media_recorder' });
    getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingCanvas().ctx as never);
});
afterEach(() => getContext.mockRestore());

describe('ShareDialog defaults', () => {
    it('opens with every identity toggle off and the footer on', async () => {
        open();
        const dialog = await screen.findByRole('dialog', { name: 'シェア用に書き出す' });
        expect(within(dialog).getByRole('switch', { name: 'ニックネームを入れる' })).toHaveAttribute('aria-checked', 'false');
        expect(within(dialog).getByRole('switch', { name: '自分のアイコンを入れる' })).toHaveAttribute('aria-checked', 'false');
        expect(within(dialog).getByRole('switch', { name: '「3年目」を入れる' })).toHaveAttribute('aria-checked', 'false');
        expect(within(dialog).getByRole('switch', { name: '「SakaDesk」を入れる' })).toHaveAttribute('aria-checked', 'true');
        expect(within(dialog).getByRole('button', { name: 'すりガラスのコラージュ' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('prefills two of her sentences with the nickname masked', async () => {
        open();
        const list = await screen.findByRole('group', { name: '彼女のことば（2つまで）' });
        const chosen = within(list).getAllByRole('button', { pressed: true });
        expect(chosen).toHaveLength(2);
        expect(chosen[0]).toHaveTextContent('一緒に歩いてくれて、ありがとう。');
        expect(chosen[1]).toHaveTextContent('『＊＊＊』、また明日ね');
        expect(screen.getByRole('dialog')).not.toHaveTextContent('ゆき');
    });

    it('shows the nickname only after the fan turns it on', async () => {
        open();
        await userEvent.click(await screen.findByRole('switch', { name: 'ニックネームを入れる' }));
        expect(screen.getByRole('dialog')).toHaveTextContent('ゆき、また明日ね');
        expect(shareLogs()).toContainEqual(expect.objectContaining({ phase: 'option', key: 'nickname', outcome: 'on' }));
    });

    it('allows at most two sentences; a third waits until one is removed', async () => {
        open();
        const list = await screen.findByRole('group', { name: '彼女のことば（2つまで）' });
        const third = within(list).getByRole('button', { name: /大好きだよ/ });
        expect(third).toHaveAttribute('aria-disabled', 'true');
        await userEvent.click(third);
        expect(within(list).getAllByRole('button', { pressed: true })).toHaveLength(2);
        await userEvent.click(within(list).getByRole('button', { name: /一緒に歩いてくれて/ }));
        await userEvent.click(third);
        const chosen = within(list).getAllByRole('button', { pressed: true });
        expect(chosen.map((b) => b.textContent)).toEqual(['『＊＊＊』、また明日ね', '大好きだよ']);
        expect(shareLogs()).toContainEqual({ phase: 'sentence', outcome: 'removed', count: 1 });
    });

    it('hides the video button when recording is unsupported', async () => {
        open();
        await screen.findByRole('dialog');
        expect(screen.queryByRole('button', { name: '動画' })).toBeNull();
        expect(shareLogs()).toContainEqual(expect.objectContaining({ phase: 'video_unsupported', reason: 'no_media_recorder' }));
    });

    it('logs the open and the skipped photos with counts only', async () => {
        open();
        await waitFor(() => expect(shareLogs()).toContainEqual(expect.objectContaining({ phase: 'photo_skip', reason: 'load_failed', count: 1 })));
        expect(shareLogs()).toContainEqual(expect.objectContaining({ phase: 'open', member_id: '58' }));
    });
});

describe('ShareDialog export', () => {
    it('exports the GIF through the local handoff with neutral copy', async () => {
        open();
        await userEvent.click(await screen.findByRole('button', { name: 'GIF' }));
        await screen.findByText('書き出しを始めました。');
        expect(renderGifFrames).toHaveBeenCalled();
        expect(postShareGif).toHaveBeenCalledWith(
            expect.objectContaining({ fps: 15, width: 540, height: 960, frames: ['AAAA'], durations_ms: [8000] }),
            'sakadesk-recap-2026-58-share.gif', undefined, expect.any(AbortSignal),
        );
        expect(shareLogs()).toContainEqual({ phase: 'export_start', kind: 'gif', style: 'collage', count: 2, member_id: '58' });
        expect(shareLogs()).toContainEqual({ phase: 'export', kind: 'gif', outcome: 'handed_off', member_id: '58' });
        expect(screen.queryByText(/保存しました/)).toBeNull();
        // No text, nickname or file name reaches a breadcrumb.
        expect(JSON.stringify(shareLogs())).not.toMatch(/ゆき|また明日|sakadesk-recap/);
    });

    it('exports the share PNG', async () => {
        open();
        await userEvent.click(await screen.findByRole('button', { name: '画像' }));
        await screen.findByText('書き出しを始めました。');
        expect(saveShareBlob).toHaveBeenCalledWith(expect.any(Blob), 'png', 'sakadesk-recap-2026-58-share.png', undefined, expect.any(AbortSignal));
    });

    it('records the video from the canvas only when supported (no voice, no music)', async () => {
        vi.mocked(videoSupport).mockReturnValue({ supported: true, mimeType: 'video/webm;codecs=vp9' });
        const play = vi.mocked(HTMLMediaElement.prototype.play);
        play.mockClear();
        open();
        await userEvent.click(await screen.findByRole('button', { name: '動画' }));
        await screen.findByText('書き出しを始めました。');
        expect(recordVideo).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ mimeType: 'video/webm;codecs=vp9' }));
        expect(saveShareBlob).toHaveBeenCalledWith(expect.any(Blob), 'webm', 'sakadesk-recap-2026-58-share.webm', undefined, expect.any(AbortSignal));
        expect(play).not.toHaveBeenCalled();
    });

    it('says so when the export fails and logs the code', async () => {
        vi.mocked(postShareGif).mockRejectedValueOnce(new ShareSaveError('export_rejected', 'frame_size'));
        open();
        await userEvent.click(await screen.findByRole('button', { name: 'GIF' }));
        await screen.findByText('書き出せませんでした。');
        expect(shareLogs()).toContainEqual(expect.objectContaining({
            phase: 'export_failed', kind: 'gif', reason: 'write_failed', error_code: 'frame_size',
        }));
    });

    it('falls back to system fonts with one breadcrumb per opening', async () => {
        vi.mocked(ensureShareFonts).mockResolvedValue('font_timeout');
        open();
        await userEvent.click(await screen.findByRole('button', { name: 'GIF' }));
        await screen.findByText('書き出しを始めました。');
        await userEvent.click(screen.getByRole('button', { name: 'GIF' }));
        await waitFor(() => expect(postShareGif).toHaveBeenCalledTimes(2));
        expect(shareLogs().filter((f) => (f as { phase: string }).phase === 'font_fallback')).toEqual([
            { phase: 'font_fallback', fallback: 'font_timeout', member_id: '58' },
        ]);
        vi.mocked(ensureShareFonts).mockResolvedValue(null);
    });
});

/** A promise that settles only when `signal` aborts (as the real export steps do). */
function untilAborted<T>(signal: AbortSignal | undefined, error: Error): Promise<T> {
    return new Promise<T>((_resolve, reject) => {
        if (signal?.aborted) reject(error);
        signal?.addEventListener('abort', () => reject(error));
    });
}

const exportLogs = () => shareLogs().filter((f) => ['export', 'export_failed'].includes((f as { phase: string }).phase));

describe('ShareDialog cancel', () => {
    it('Cancel during recording aborts the recorder and never hands the video off', async () => {
        vi.mocked(videoSupport).mockReturnValue({ supported: true, mimeType: 'video/webm;codecs=vp9' });
        let signal: AbortSignal | undefined;
        vi.mocked(recordVideo).mockImplementationOnce((_r, _c, opts) => {
            signal = opts.signal;
            return untilAborted(opts.signal, new ShareCancelledError());
        });
        open();
        await userEvent.click(await screen.findByRole('button', { name: '動画' }));
        await userEvent.click(await screen.findByRole('button', { name: 'やめる' }));
        await screen.findByText('書き出しを取りやめました。');
        expect(signal?.aborted).toBe(true);
        expect(saveShareBlob).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: '動画' })).not.toHaveAttribute('aria-busy');
        expect(screen.queryByRole('button', { name: 'やめる' })).toBeNull();
        await waitFor(() => expect(exportLogs()).toEqual([{ phase: 'export_failed', kind: 'webm', reason: 'cancelled', member_id: '58' }]));
    });

    it('closing the dialog during the GIF upload aborts the fetch and logs the cancel', async () => {
        let signal: AbortSignal | undefined;
        vi.mocked(postShareGif).mockImplementationOnce((_b, _f, _fetch, s) => {
            signal = s;
            return untilAborted(s, new ShareSaveError('export_cancelled'));
        });
        const onClose = vi.fn();
        open(recap(), onClose);
        await userEvent.click(await screen.findByRole('button', { name: 'GIF' }));
        await waitFor(() => expect(postShareGif).toHaveBeenCalled());
        await userEvent.click(screen.getByRole('button', { name: i18n.t('common.close') }));
        expect(onClose).toHaveBeenCalled();
        expect(signal?.aborted).toBe(true);
        await waitFor(() => expect(exportLogs()).toEqual([{ phase: 'export_failed', kind: 'gif', reason: 'cancelled', member_id: '58' }]));
    });

    it('a GIF answer that lands after Cancel is not reported as handed off', async () => {
        let finish: (v: { outcome: 'handed_off' }) => void = () => {};
        vi.mocked(postShareGif).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        open();
        await userEvent.click(await screen.findByRole('button', { name: 'GIF' }));
        await waitFor(() => expect(postShareGif).toHaveBeenCalled());
        await userEvent.click(screen.getByRole('button', { name: 'やめる' }));
        await act(async () => { finish({ outcome: 'handed_off' }); });
        expect(screen.queryByText('書き出しを始めました。')).toBeNull();
        expect(exportLogs()).toEqual([{ phase: 'export_failed', kind: 'gif', reason: 'cancelled', member_id: '58' }]);
    });

    it('reopening resets busy and progress after an export was abandoned', async () => {
        let signal: AbortSignal | undefined;
        vi.mocked(postShareGif).mockImplementationOnce((_b, _f, _fetch, s) => {
            signal = s;
            return untilAborted(s, new ShareSaveError('export_cancelled'));
        });
        const r = recap();
        const view = render(<ShareDialog isOpen recap={r} nickname="ゆき" onClose={vi.fn()} />);
        await userEvent.click(await screen.findByRole('button', { name: 'GIF' }));
        await waitFor(() => expect(postShareGif).toHaveBeenCalled());
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
        view.rerender(<ShareDialog isOpen={false} recap={r} nickname="ゆき" onClose={vi.fn()} />);
        expect(signal?.aborted).toBe(true);
        view.rerender(<ShareDialog isOpen recap={r} nickname="ゆき" onClose={vi.fn()} />);
        const gif = await screen.findByRole('button', { name: 'GIF' });
        expect(gif).not.toHaveAttribute('aria-busy');
        expect(gif).not.toHaveAttribute('aria-disabled');
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.queryByRole('button', { name: 'やめる' })).toBeNull();
        expect(screen.getByRole('status')).toHaveTextContent('');
        // A fresh export can start right away.
        await userEvent.click(gif);
        await screen.findByText('書き出しを始めました。');
    });

    it('unmounting (the poster closed) aborts a running export', async () => {
        let signal: AbortSignal | undefined;
        vi.mocked(renderGifFrames).mockImplementationOnce((_r, _c, opts) => {
            signal = opts?.signal;
            return untilAborted(opts?.signal, new ShareCancelledError());
        });
        const view = open();
        await userEvent.click(await screen.findByRole('button', { name: 'GIF' }));
        await waitFor(() => expect(renderGifFrames).toHaveBeenCalled());
        view.unmount();
        expect(signal?.aborted).toBe(true);
        await waitFor(() => expect(exportLogs()).toEqual([{ phase: 'export_failed', kind: 'gif', reason: 'cancelled', member_id: '58' }]));
        expect(postShareGif).not.toHaveBeenCalled();
    });
});

describe('ShareDialog busy state', () => {
    it('visibly blocks the other export buttons while one runs', async () => {
        vi.mocked(postShareGif).mockImplementationOnce((_b, _f, _fetch, s) => untilAborted(s, new ShareSaveError('export_cancelled')));
        open();
        await userEvent.click(await screen.findByRole('button', { name: 'GIF' }));
        await waitFor(() => expect(postShareGif).toHaveBeenCalled());
        const png = screen.getByRole('button', { name: '画像' });
        expect(png).toHaveAttribute('aria-disabled', 'true');
        expect(png).toHaveAccessibleDescription('ほかの書き出しを進めています。');
        expect(screen.getByRole('button', { name: 'GIF' })).toHaveAttribute('aria-busy', 'true');
        await userEvent.click(png);
        expect(saveShareBlob).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'やめる' }));
        expect(screen.getByRole('button', { name: '画像' })).not.toHaveAttribute('aria-disabled');
    });
});

describe('ShareDialog avatar file', () => {
    async function pick(file: File) {
        open();
        await userEvent.click(await screen.findByRole('switch', { name: '自分のアイコンを入れる' }));
        await userEvent.click(screen.getByRole('button', { name: '画像を選ぶ' }));
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(input, { target: { files: [file] } });
    }

    it('refuses a file over 10 MB with a message', async () => {
        const big = new File(['x'], 'big.png', { type: 'image/png' });
        Object.defineProperty(big, 'size', { value: MAX_AVATAR_BYTES + 1 });
        const bitmap = vi.fn(async () => ({}) as ImageBitmap);
        vi.stubGlobal('createImageBitmap', bitmap);
        await pick(big);
        expect(await screen.findByRole('alert')).toHaveTextContent('10MBより大きい画像です。もっと小さい画像を選んでください。');
        expect(bitmap).not.toHaveBeenCalled();
        expect(shareLogs()).toContainEqual({ phase: 'option', key: 'avatar', outcome: 'rejected', reason: 'too_large', member_id: '58' });
        vi.unstubAllGlobals();
    });

    it('refuses a file that is not an image with a message', async () => {
        await pick(new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('画像ではないファイルです。画像を選んでください。');
        expect(shareLogs()).toContainEqual({ phase: 'option', key: 'avatar', outcome: 'rejected', reason: 'not_image', member_id: '58' });
    });

    it('accepts an image at the cap', async () => {
        const ok = new File(['x'], 'me.png', { type: 'image/png' });
        Object.defineProperty(ok, 'size', { value: MAX_AVATAR_BYTES });
        vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 64, height: 64 }) as ImageBitmap));
        await pick(ok);
        await waitFor(() => expect(shareLogs()).toContainEqual({ phase: 'option', key: 'avatar', outcome: 'picked', member_id: '58' }));
        expect(screen.queryByRole('alert')).toBeNull();
        vi.unstubAllGlobals();
    });
});

describe('ShareDialog blur fallback', () => {
    it('leaves a share_blur_fallback breadcrumb when photos were box-blurred', async () => {
        vi.mocked(loadShareAssets).mockResolvedValueOnce({ photos: [], months: [], skipped: 0, blurFallback: true });
        open();
        await waitFor(() => expect(shareLogs()).toContainEqual({
            phase: 'share_blur_fallback', reason: 'filter_unsupported', count: 0, member_id: '58',
        }));
    });
});

/** A promise the test settles by hand (the photos still loading). */
function deferred<T>() {
    let resolve: (v: T) => void = () => {};
    let reject: (e: unknown) => void = () => {};
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

type Assets = Awaited<ReturnType<typeof loadShareAssets>>;
const PREVIEW_LOADING = 'プレビューを準備中…';
const PREPARING = '写真を準備中…';
const UNAVAILABLE = '写真を読み込めなかったため、写真なしで書き出します。';
const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => {}); };

describe('ShareDialog preview loading and the photo gate (L7)', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('covers the blank preview with a skeleton and reveals its spinner at 200 ms, not 199', async () => {
        vi.useFakeTimers();
        vi.mocked(loadShareAssets).mockImplementationOnce(() => deferred<Assets>().promise);
        open();
        const overlay = screen.getByTestId('share-preview-loading');
        expect(overlay.querySelector('[data-skeleton]')).not.toBeNull();
        act(() => { vi.advanceTimersByTime(199); });
        expect(screen.queryByRole('status', { name: PREVIEW_LOADING })).toBeNull();
        act(() => { vi.advanceTimersByTime(1); });
        const spinner = screen.getByRole('status', { name: PREVIEW_LOADING });
        expect(spinner.querySelector('svg')).toHaveClass('animate-spin', 'motion-reduce:animate-none');
    });

    it('says 「写真を準備中…」 beside the blocked buttons from 200 ms, then the still-working line at 3 s', async () => {
        vi.useFakeTimers();
        vi.mocked(loadShareAssets).mockImplementationOnce(() => deferred<Assets>().promise);
        open();
        const line = () => screen.queryByTestId('share-photos-waiting');
        act(() => { vi.advanceTimersByTime(199); });
        expect(line()).toBeNull();
        act(() => { vi.advanceTimersByTime(1); });
        expect(line()).toHaveTextContent(PREPARING);
        expect(line()).toHaveClass('text-small', 'text-secondary');
        expect(line()).toBeVisible();
        act(() => { vi.advanceTimersByTime(2_799); });
        expect(line()).toHaveTextContent(PREPARING);
        act(() => { vi.advanceTimersByTime(1); });
        expect(line()).toHaveTextContent(i18n.t('loading.slow'));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('ui_wait', { surface: 'recap_share', phase: 'slow', wait_ms: 3_000 });
    });

    it('keeps a revealed 「写真を準備中…」 line its 400 ms minimum when the photos settle at 210 ms (m5)', async () => {
        vi.useFakeTimers();
        const photos = deferred<Assets>();
        vi.mocked(loadShareAssets).mockImplementationOnce(() => photos.promise);
        open();
        const line = () => screen.queryByTestId('share-photos-waiting');
        act(() => { vi.advanceTimersByTime(210); });
        expect(line()).toHaveTextContent(PREPARING);
        await act(async () => { photos.resolve({ photos: [], months: [], skipped: 0 }); });
        expect(line()).toHaveTextContent(PREPARING);
        act(() => { vi.advanceTimersByTime(389); }); // 599: still inside reveal + minVisible
        expect(line()).toHaveTextContent(PREPARING);
        act(() => { vi.advanceTimersByTime(1); }); // 600
        expect(line()).toBeNull();
        expect(screen.getByRole('button', { name: 'GIF' })).not.toHaveAttribute('aria-disabled');
    });

    it('drops the waiting line once the photos arrive', async () => {
        const photos = deferred<Assets>();
        vi.mocked(loadShareAssets).mockImplementationOnce(() => photos.promise);
        open();
        expect(await screen.findByTestId('share-photos-waiting')).toHaveTextContent(PREPARING);
        await act(async () => { photos.resolve({ photos: [], months: [], skipped: 0 }); });
        await waitFor(() => expect(screen.queryByTestId('share-photos-waiting')).toBeNull());
    });

    it('a preview that cannot be drawn lifts the cover and says so quietly in the box', async () => {
        getContext.mockImplementation(() => null as never);
        open();
        const note = await screen.findByTestId('share-preview-failed');
        expect(note).toHaveTextContent(i18n.t('loading.error'));
        expect(screen.queryByTestId('share-preview-loading')).toBeNull();
        await waitFor(() => expect(shareLogs()).toContainEqual({ phase: 'preview_failed', reason: 'render_failed', member_id: '58' }));
    });

    it('blocks every export with 「写真を準備中…」 until the photos settle, and a click starts nothing', async () => {
        vi.mocked(videoSupport).mockReturnValue({ supported: true, mimeType: 'video/webm;codecs=vp9' });
        vi.mocked(loadShareAssets).mockImplementationOnce(() => deferred<Assets>().promise);
        open();
        await screen.findByRole('dialog');
        for (const name of ['GIF', '画像', '動画']) {
            const button = screen.getByRole('button', { name });
            expect(button).toHaveAttribute('aria-disabled', 'true');
            expect(button).toHaveAttribute('title', PREPARING);
            expect(button).toHaveAccessibleDescription(PREPARING);
        }
        fireEvent.click(screen.getByRole('button', { name: 'GIF' }));
        fireEvent.click(screen.getByRole('button', { name: '画像' }));
        fireEvent.click(screen.getByRole('button', { name: '動画' }));
        await flush();
        expect(renderGifFrames).not.toHaveBeenCalled();
        expect(saveShareBlob).not.toHaveBeenCalled();
        expect(recordVideo).not.toHaveBeenCalled();
        expect(shareLogs().some((f) => (f as { phase: string }).phase === 'export_start')).toBe(false);
    });

    it('removes the overlay after the first draw and enables the exports once the photos arrive', async () => {
        const photos = deferred<Assets>();
        vi.mocked(loadShareAssets).mockImplementationOnce(() => photos.promise);
        open();
        expect(screen.getByTestId('share-preview-loading')).toBeInTheDocument();
        await act(async () => { photos.resolve({ photos: [], months: [], skipped: 0 }); });
        await waitFor(() => expect(screen.queryByTestId('share-preview-loading')).toBeNull());
        expect(screen.getByRole('button', { name: 'GIF' })).not.toHaveAttribute('aria-disabled');
        expect(screen.getByRole('button', { name: '画像' })).not.toHaveAttribute('aria-disabled');
        expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    });

    it('when the photos fail, says the export will have no photos and lets it run without them', async () => {
        const photos = deferred<Assets>();
        vi.mocked(loadShareAssets).mockImplementationOnce(() => photos.promise);
        open();
        await act(async () => { photos.reject(new Error('写真 🌸 failed')); });
        const line = await screen.findByText(UNAVAILABLE);
        expect(line).toHaveClass('text-small', 'text-secondary');
        expect(screen.getByRole('button', { name: 'GIF' })).not.toHaveAttribute('aria-disabled');
        await userEvent.click(screen.getByRole('button', { name: 'GIF' }));
        await screen.findByText('書き出しを始めました。');
        const renderer = vi.mocked(renderGifFrames).mock.calls[0][0] as unknown as { assets: Assets };
        expect(renderer.assets.photos).toEqual([]);
        expect(shareLogs()).toContainEqual({ phase: 'photo_skip', reason: 'load_failed', member_id: '58' });
        expect(JSON.stringify(shareLogs())).not.toMatch(/写真|🌸/);
    });

    it('gives up on the photos at 15 s (not 14,999 ms), says so and logs the timeout', async () => {
        vi.useFakeTimers();
        vi.mocked(loadShareAssets).mockImplementationOnce(() => new Promise<Assets>(() => {}));
        open();
        await act(async () => { vi.advanceTimersByTime(14_999); });
        await flush();
        expect(screen.queryByText(UNAVAILABLE)).toBeNull();
        expect(screen.getByRole('button', { name: 'GIF' })).toHaveAttribute('aria-disabled', 'true');
        await act(async () => { vi.advanceTimersByTime(1); });
        await flush();
        expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'GIF' })).not.toHaveAttribute('aria-disabled');
        expect(screen.queryByTestId('share-preview-loading')).toBeNull();
        expect(shareLogs()).toContainEqual({ phase: 'photo_skip', reason: 'timeout', member_id: '58' });
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('ui_wait', { surface: 'recap_share', phase: 'timeout', wait_ms: 15_000 });
    });

    it('offers Cancel from the very-slow mark (10 s); it stops the photo wait and returns to idle without photos', async () => {
        vi.useFakeTimers();
        vi.mocked(loadShareAssets).mockImplementationOnce(() => new Promise<Assets>(() => {}));
        open();
        const cancel = () => screen.queryByRole('button', { name: i18n.t('loading.cancel') });
        await act(async () => { vi.advanceTimersByTime(9_999); });
        expect(cancel()).toBeNull();
        await act(async () => { vi.advanceTimersByTime(1); });
        expect(screen.getByTestId('share-photos-waiting')).toHaveTextContent(i18n.t('loading.verySlow'));
        expect(cancel()).not.toBeNull();
        await act(async () => { fireEvent.click(cancel()!); });
        await flush();
        // Idle: no wait line, no Cancel, the exports open (without photos) and the dialog says why.
        expect(screen.queryByTestId('share-photos-waiting')).toBeNull();
        expect(cancel()).toBeNull();
        expect(screen.getByText(i18n.t('recap.share.photosSkipped'))).toBeInTheDocument();
        expect(screen.queryByText(UNAVAILABLE)).toBeNull();
        expect(screen.getByRole('button', { name: 'GIF' })).not.toHaveAttribute('aria-disabled');
        expect(shareLogs()).toContainEqual({ phase: 'photo_skip', reason: 'cancelled', member_id: '58' });
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('ui_wait', { surface: 'recap_share', phase: 'cancelled', wait_ms: 10_000 });
        // The 15 s timeout no longer fires afterwards.
        await act(async () => { vi.advanceTimersByTime(10_000); });
        await flush();
        expect(shareLogs()).not.toContainEqual(expect.objectContaining({ reason: 'timeout' }));
    });

    it.each([
        ['resolves', (d: ReturnType<typeof deferred<Assets>>) => d.resolve({ photos: [], months: [], skipped: 3, blurFallback: true })],
        ['rejects', (d: ReturnType<typeof deferred<Assets>>) => d.reject(new Error('写真 🌸 failed'))],
    ] as const)('ignores a photo load that %s after Cancel, and aborts it on Cancel', async (_how, settle) => {
        vi.useFakeTimers();
        const photos = deferred<Assets>();
        vi.mocked(loadShareAssets).mockImplementationOnce(() => photos.promise);
        open();
        const opts = vi.mocked(loadShareAssets).mock.calls[vi.mocked(loadShareAssets).mock.calls.length - 1][1] as { signal?: AbortSignal };
        expect(opts.signal?.aborted).toBe(false);
        await act(async () => { vi.advanceTimersByTime(10_000); });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: i18n.t('loading.cancel') })); });
        await flush();
        expect(opts.signal?.aborted).toBe(true);
        const logsAfterCancel = shareLogs().length;
        await act(async () => { settle(photos); });
        await flush();
        // Still the cancelled idle state: the skipped line, never the failure line, no new breadcrumbs.
        expect(screen.getByText(i18n.t('recap.share.photosSkipped'))).toBeInTheDocument();
        expect(screen.queryByText(UNAVAILABLE)).toBeNull();
        expect(shareLogs()).toHaveLength(logsAfterCancel);
        expect(screen.getByRole('button', { name: 'GIF' })).not.toHaveAttribute('aria-disabled');
        // The export runs with no photos (the late answer never replaced them).
        vi.useRealTimers();
        await userEvent.click(screen.getByRole('button', { name: 'GIF' }));
        await screen.findByText('書き出しを始めました。');
        const renderer = vi.mocked(renderGifFrames).mock.calls[0][0] as unknown as { assets: Assets };
        expect(renderer.assets).toMatchObject({ photos: [], skipped: 0 });
    });

    it('a reopening waits for its own photos again', async () => {
        const r = recap();
        const view = render(<ShareDialog isOpen recap={r} nickname="ゆき" onClose={vi.fn()} />);
        await waitFor(() => expect(screen.queryByTestId('share-preview-loading')).toBeNull());
        vi.mocked(loadShareAssets).mockImplementationOnce(() => deferred<Assets>().promise);
        view.rerender(<ShareDialog isOpen={false} recap={r} nickname="ゆき" onClose={vi.fn()} />);
        view.rerender(<ShareDialog isOpen recap={r} nickname="ゆき" onClose={vi.fn()} />);
        await flush();
        expect(screen.getByTestId('share-preview-loading')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'GIF' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('shows the export progress on the shared ProgressBar with its value', async () => {
        vi.mocked(renderGifFrames).mockImplementationOnce((_r, _c, opts) => {
            opts?.onProgress?.(0.5);
            return untilAborted(opts?.signal, new ShareCancelledError());
        });
        open();
        await waitFor(() => expect(screen.getByRole('button', { name: 'GIF' })).not.toHaveAttribute('aria-disabled'));
        await userEvent.click(screen.getByRole('button', { name: 'GIF' }));
        const bar = await screen.findByRole('progressbar', { name: i18n.t('recap.share.progressLabel') });
        await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '40'));
        expect(bar.querySelector('[data-progress-fill]')).toHaveClass('motion-reduce:transition-none');
        await userEvent.click(screen.getByRole('button', { name: 'やめる' }));
    });
});
