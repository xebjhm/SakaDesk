import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../../i18n';
import { ShareDialog } from './ShareDialog';
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
import { ShareSaveError } from './shareExport';

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
            'sakadesk-recap-2026-58-share.gif',
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
        expect(saveShareBlob).toHaveBeenCalledWith(expect.any(Blob), 'png', 'sakadesk-recap-2026-58-share.png');
    });

    it('records the video from the canvas only when supported (no voice, no music)', async () => {
        vi.mocked(videoSupport).mockReturnValue({ supported: true, mimeType: 'video/webm;codecs=vp9' });
        const play = vi.mocked(HTMLMediaElement.prototype.play);
        play.mockClear();
        open();
        await userEvent.click(await screen.findByRole('button', { name: '動画' }));
        await screen.findByText('書き出しを始めました。');
        expect(recordVideo).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ mimeType: 'video/webm;codecs=vp9' }));
        expect(saveShareBlob).toHaveBeenCalledWith(expect.any(Blob), 'webm', 'sakadesk-recap-2026-58-share.webm');
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
