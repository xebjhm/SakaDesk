import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { PosterView } from './PosterView';
import { clockData, payload, posterData, s01 } from './__fixtures__/payload';
import type { RecapPayload, RecapPoster } from './api';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';

vi.mock('./posterImage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./posterImage')>();
    return {
        SaveError: actual.SaveError,
        NOWRAP_ATTR: actual.NOWRAP_ATTR,
        readCssVar: actual.readCssVar,
        saveBlob: actual.saveBlob,
        renderToCanvas: vi.fn(async () => ({ canvas: {}, fontFallbacks: [], fontTruncation: null })),
        canvasToPng: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
        savePng: vi.fn(async () => ({ outcome: 'handed_off' })),
    };
});
import { canvasToPng, renderToCanvas, SaveError, savePng } from './posterImage';

const posterLogs = () => vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'recap_poster').map(([, f]) => f);

beforeAll(async () => { await i18n.changeLanguage('ja'); });
beforeEach(() => { vi.mocked(clientLog).mockClear(); vi.mocked(savePng).mockClear(); });

const renderPoster = (poster: Partial<RecapPoster> = {}, over: Partial<RecapPayload> = {}, handlers: { onReplay?: () => void; onClose?: () => void } = {}) =>
    render(
        <PosterView
            recap={payload({ poster: posterData(poster), ...over })}
            nickname="ゆき"
            onReplay={handlers.onReplay ?? (() => {})}
            onClose={handlers.onClose ?? (() => {})}
        />,
    );

describe('PosterView', () => {
    it('fills the pane so the poster centres in it, not in a content-wide sliver (D2)', () => {
        renderPoster();
        expect(screen.getByTestId('atmosphere-content')).toHaveClass('w-full', 'min-w-0');
    });

    it('lays out the year, member, "with" line, polaroid, sentence and signature', () => {
        renderPoster();
        const poster = screen.getByTestId('recap-poster');
        expect(within(poster).getByText('2026')).toBeInTheDocument();
        expect(within(poster).getByText('金村 美玖')).toHaveAttribute('lang', 'ja');
        expect(within(poster).getByText('with ゆき')).toBeInTheDocument();
        expect(within(poster).getByTestId('poster-polaroid').querySelector('img')).toHaveAttribute('src', '/api/content/media/best.jpg');
        const caption = within(poster).getByText('ゆきに見せたかった空');
        expect(caption).toHaveAttribute('lang', 'ja');
        expect(caption.className).toMatch(/font-display/);
        const sentence = within(poster).getByText('一緒に歩いてくれて、ありがとう。');
        expect(sentence).toHaveStyle({ writingMode: 'vertical-rl' });
        expect(within(poster).getByText('Dedicated to ゆき')).toBeInTheDocument();
        expect(within(poster).getByText('2024年7月24日から購読')).toBeInTheDocument();
        expect(within(poster).getByTestId('poster-favorites')).toHaveTextContent('12');
        expect(within(poster).getByTestId('poster-letters')).toHaveTextContent('3');
        expect(within(poster).getAllByTestId('poster-smr')).toHaveLength(3);
        // The 360-px prints (a third of the 1080-px export) use the smallest width covering them:
        // 480 at DPR 1 (the export may still use 640 at a higher DPR: `large`).
        expect(within(poster).getAllByTestId('poster-smr')[0].querySelector('img'))
            .toHaveAttribute('src', '/api/content/thumb/s.jpg?w=480');
        expect(within(poster).getAllByTestId('poster-stub')).toHaveLength(1);
        expect(within(poster).getByTestId('poster-stub')).toHaveTextContent('0:00:07');
        // One line on screen and in the exported image (D-M6: the PNG wrapped the date stub).
        expect(within(poster).getByTestId('poster-stub')).toHaveAttribute('data-image-nowrap');
        expect(within(poster).getByTestId('poster-stub').className).toContain('whitespace-nowrap');
    });

    it('shows at most three relationship numbers, never a total', () => {
        renderPoster({
            numbers: [
                { key: 'nickname', count: 42 }, { key: 'oyasumi', count: 180 }, { key: 'photos', count: 96 },
                { key: 'voice', count: 30 }, { key: 'daisuki', count: 12 },
            ],
        });
        const numbers = screen.getAllByTestId('poster-number');
        expect(numbers).toHaveLength(3);
        expect(numbers[1]).toHaveTextContent('180回の『おやすみ』で一日を締めくくった。');
        expect(posterLogs()).toContainEqual(expect.objectContaining({ phase: 'open', count: 3, member_id: '58' }));
    });

    it('shows the avatar-change row only when the avatar changed', () => {
        const { unmount } = renderPoster({ avatar_changed: false });
        expect(screen.queryByTestId('poster-avatar-change')).toBeNull();
        unmount();
        renderPoster({ avatar_changed: true, avatar_old_url: '/api/content/media/old.jpg', avatar_new_url: '/api/content/media/new.jpg' });
        const row = screen.getByTestId('poster-avatar-change');
        expect(row.querySelectorAll('img')).toHaveLength(2);
        expect(row).toHaveTextContent('今年、アイコンが変わった。');
    });

    it('shows years together only from the second year', () => {
        for (const years of [null, 1]) {
            const { unmount } = renderPoster({ years_together: years });
            expect(screen.queryByTestId('poster-years')).toBeNull();
            unmount();
        }
        renderPoster({ years_together: 3 });
        expect(screen.getByTestId('poster-years')).toHaveTextContent('メッセージを受け取って、3年目。');
    });

    it('leaves out the subscription line when the start is unknown', () => {
        renderPoster({}, { member: { ...payload().member, subscription_start: null } });
        expect(screen.getByText('Dedicated to ゆき')).toBeInTheDocument();
        expect(screen.queryByText(/から購読/)).toBeNull();
    });

    it('reuses the star dial when the clock slide exists', () => {
        const { unmount } = renderPoster({}, { slides: [s01, { key: 's03_clock', fallback: null, data: clockData() }] });
        expect(screen.getByRole('img', { name: '彼女の一日の星時計' })).toBeInTheDocument();
        unmount();
        renderPoster({}, { slides: [s01] });
        expect(screen.queryByRole('img', { name: '彼女の一日の星時計' })).toBeNull();
    });

    it('renders nothing without a poster', () => {
        const { container } = render(<PosterView recap={payload({ poster: null })} nickname="ゆき" onReplay={() => {}} onClose={() => {}} />);
        expect(container.innerHTML).toBe('');
    });

    it('replays and closes', async () => {
        const onReplay = vi.fn();
        const onClose = vi.fn();
        renderPoster({}, {}, { onReplay, onClose });
        await userEvent.click(screen.getByRole('button', { name: 'もう一度見る' }));
        expect(onReplay).toHaveBeenCalledTimes(1);
        await userEvent.click(screen.getByRole('button', { name: '閉じる' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(posterLogs().map((f) => (f as { phase: string }).phase)).toEqual(['open', 'replay', 'close']);
    });

    it('saves the poster as a PNG named by year and member id', async () => {
        renderPoster();
        await userEvent.click(screen.getByRole('button', { name: '画像を保存' }));
        await waitFor(() => expect(savePng).toHaveBeenCalledTimes(1));
        expect(renderToCanvas).toHaveBeenCalledWith(screen.getByTestId('recap-poster'));
        expect(canvasToPng).toHaveBeenCalled();
        expect(vi.mocked(savePng).mock.calls[0][1]).toBe('sakadesk-recap-2026-58.png');
        // The handoff only starts the save; the copy never claims the file was saved.
        expect(await screen.findByRole('status')).toHaveTextContent('画像の保存を始めました。');
        expect(screen.getByRole('status')).not.toHaveTextContent('保存しました');
        expect(posterLogs()).toContainEqual(expect.objectContaining({ phase: 'save', outcome: 'handed_off', member_id: '58' }));
        expect(screen.getByRole('button', { name: '画像を保存' })).not.toBeDisabled();
    });

    it('shows the error state with a code when the handoff is refused, and leaves loading', async () => {
        vi.mocked(savePng).mockRejectedValueOnce(new SaveError('export_too_large'));
        renderPoster();
        await userEvent.click(screen.getByRole('button', { name: '画像を保存' }));
        expect(await screen.findByRole('status')).toHaveTextContent('保存できませんでした。');
        expect(posterLogs()).toContainEqual(expect.objectContaining({
            phase: 'save_failed', reason: 'write_failed', error_code: 'export_too_large', member_id: '58',
        }));
        expect(posterLogs().some((f) => (f as { phase: string }).phase === 'save')).toBe(false);
        expect(screen.getByRole('button', { name: '画像を保存' })).not.toBeDisabled();
    });

    it('logs every font fallback separately, with counts for the budget cut', async () => {
        vi.mocked(renderToCanvas).mockResolvedValueOnce({
            canvas: {} as HTMLCanvasElement,
            fontFallbacks: ['font_embed_timeout', 'font_partial', 'font_truncated'],
            fontTruncation: { needed: 70, truncated: 6 },
        });
        renderPoster();
        await userEvent.click(screen.getByRole('button', { name: '画像を保存' }));
        await waitFor(() => expect(savePng).toHaveBeenCalledTimes(1));
        const fonts = posterLogs().filter((f) => (f as { phase: string }).phase === 'font_fallback');
        expect(fonts).toEqual([
            { phase: 'font_fallback', fallback: 'font_embed_timeout', member_id: '58' },
            { phase: 'font_fallback', fallback: 'font_partial', member_id: '58' },
            { phase: 'font_fallback', fallback: 'font_truncated', member_id: '58', count: 70, dropped: 6 },
        ]);
    });

    it('logs where the poster was opened from', () => {
        renderPoster();
        expect(posterLogs()).toContainEqual(expect.objectContaining({ phase: 'open', surface: 'end' }));
    });

    it('says when saving failed and logs a code', async () => {
        vi.mocked(renderToCanvas).mockRejectedValueOnce(new Error('tainted'));
        renderPoster();
        await userEvent.click(screen.getByRole('button', { name: '画像を保存' }));
        expect(await screen.findByRole('status')).toHaveTextContent('保存できませんでした。');
        expect(posterLogs()).toContainEqual(expect.objectContaining({ phase: 'save_failed', reason: 'render_failed' }));
    });

    it('opens the share export, and Escape there closes only the share dialog', async () => {
        const onClose = vi.fn();
        renderPoster({}, {}, { onClose });
        await userEvent.click(screen.getByRole('button', { name: 'シェア用に書き出す' }));
        const dialog = await screen.findByRole('dialog', { name: 'シェア用に書き出す' });
        expect(within(dialog).getByRole('switch', { name: 'ニックネームを入れる' })).toHaveAttribute('aria-checked', 'false');
        await userEvent.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'シェア用に書き出す' })).toBeNull());
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByTestId('recap-poster')).toBeInTheDocument();
    });
});
