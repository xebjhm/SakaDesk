import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../utils/favoriteApi', () => ({ setFavorite: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchGacha: vi.fn(), postGachaPull: vi.fn() };
});
vi.mock('../favorites/FilmStrip', () => ({
    FilmStrip: (p: { memberPath: string; date: string; focusId: number; from?: string; onClose: () => void }) => (
        <div data-testid="film-strip-stub" data-member={p.memberPath} data-date={p.date} data-focus={p.focusId} data-from={p.from}>
            <button type="button" onClick={p.onClose}>close-strip</button>
        </div>
    ),
}));
import { clientLog } from '../../../utils/clientLog';
import { setFavorite } from '../../../utils/favoriteApi';
import { fetchGacha, MemoriesTimeoutError, postGachaPull, type GachaPullResult } from '../api';
import { GachaPage } from './GachaPage';
import type { GachaStatePayload } from '../types';
import { gachaPull, gachaState, MEMBER_PATH, pullPayload } from './__fixtures__';

const realMatchMedia = window.matchMedia;
beforeAll(async () => { await i18n.changeLanguage('ja'); });
afterEach(() => { window.matchMedia = realMatchMedia; });
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    vi.mocked(setFavorite).mockReset().mockResolvedValue(true);
    vi.mocked(fetchGacha).mockReset().mockResolvedValue(gachaState());
    vi.mocked(postGachaPull).mockReset().mockResolvedValue({ status: 'ok', data: pullPayload() });
});

function renderPage() {
    const go = vi.fn();
    const utils = render(<GachaPage service="hinatazaka46" go={go} />);
    return { go, ...utils };
}

const knob = () => screen.findByRole('button', { name: 'ハンドルを回す' });
const gachaLogs = () => vi.mocked(clientLog).mock.calls.filter(([event]) => event === 'memories_gacha').map(([, fields]) => fields);

/** A promise the test settles by hand. */
function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

describe('GachaPage', () => {
    it('shows the machine with the pulls left and logs open with the count', async () => {
        const { go } = renderPage();
        expect(screen.getByRole('heading', { name: '思い出ガチャ' })).toBeInTheDocument();
        await knob();
        expect(screen.getByText('今日はあと 3 回')).toBeInTheDocument();
        // The `open` breadcrumb is logged from a passive effect that runs after the commit the
        // knob appears in; findBy can resolve first under load, so wait for the log itself.
        await waitFor(() => expect(gachaLogs()).toContainEqual({ phase: 'open', count: 3 }));
        await userEvent.click(screen.getByRole('button', { name: '戻る' }));
        expect(go).toHaveBeenCalledWith({ page: 'home' });
    });

    it('a knob click pulls once, logs pull and reveal with the rarity, and opens the card', async () => {
        vi.mocked(postGachaPull).mockResolvedValue({
            status: 'ok',
            data: pullPayload(gachaPull({ rarity: 'sr', reason: 'midnight' }, { id: 55 }), 2),
        });
        renderPage();
        await userEvent.click(await knob());
        expect(postGachaPull).toHaveBeenCalledTimes(1);
        expect(await screen.findByTestId('gacha-card')).toHaveAttribute('data-rarity', 'sr');
        expect(screen.getByText('今日はあと 2 回')).toBeInTheDocument();
        await waitFor(() => expect(gachaLogs()).toContainEqual({ phase: 'pull', index: 0 }));
        await waitFor(() => expect(gachaLogs()).toContainEqual({ phase: 'reveal', kind: 'sr', reason: 'midnight', index: 0, message_id: 55 }));
        // the new pull joins the history strip
        expect(within(screen.getByRole('list', { name: 'これまでに出た思い出' })).getAllByRole('button')).toHaveLength(1);
    });

    it('Enter on the focused knob pulls', async () => {
        renderPage();
        (await knob()).focus();
        await userEvent.keyboard('{Enter}');
        await waitFor(() => expect(postGachaPull).toHaveBeenCalledTimes(1));
    });

    it('double clicks while a pull is in flight make one request', async () => {
        const pending = deferred<GachaPullResult>();
        vi.mocked(postGachaPull).mockReturnValue(pending.promise);
        renderPage();
        const k = await knob();
        await userEvent.click(k);
        await userEvent.click(k);
        await userEvent.dblClick(k);
        expect(postGachaPull).toHaveBeenCalledTimes(1);
        expect(k).toHaveAttribute('aria-disabled', 'true');
        await act(async () => { pending.resolve({ status: 'ok', data: pullPayload() }); });
        expect(await screen.findByTestId('gacha-card')).toBeInTheDocument();
        expect(k).toHaveAttribute('aria-disabled', 'false');
    });

    it('a 409 shows また明日, disables the knob and logs refused', async () => {
        vi.mocked(postGachaPull).mockResolvedValue({ status: 'no_pulls_left' });
        renderPage();
        const k = await knob();
        await userEvent.click(k);
        expect(await screen.findByText('また明日')).toBeInTheDocument();
        expect(k).toHaveAttribute('aria-disabled', 'true');
        await waitFor(() => expect(gachaLogs()).toContainEqual({ phase: 'refused', reason: 'no_pulls_left' }));
    });

    it('an empty pool logs refused empty_pool and keeps the count', async () => {
        vi.mocked(postGachaPull).mockResolvedValue({ status: 'ok', data: pullPayload(null, 3) });
        renderPage();
        await userEvent.click(await knob());
        await waitFor(() => expect(gachaLogs()).toContainEqual({ phase: 'refused', reason: 'empty_pool' }));
        expect(screen.getByText('今日はあと 3 回')).toBeInTheDocument();
        expect(screen.queryByTestId('gacha-card')).toBeNull();
    });

    it('a failed or timed-out pull refetches the state instead of retrying the write', async () => {
        vi.mocked(postGachaPull).mockRejectedValue(new MemoriesTimeoutError());
        renderPage();
        await userEvent.click(await knob());
        await waitFor(() => expect(fetchGacha).toHaveBeenCalledTimes(2));
        expect(postGachaPull).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(gachaLogs()).toContainEqual({ phase: 'refused', reason: 'request_failed' }));
    });

    it('with no pulls left the knob is disabled and no 0 is shown', async () => {
        vi.mocked(fetchGacha).mockResolvedValue(gachaState({ pulls_left: 0 }));
        const { container } = renderPage();
        const k = await knob();
        expect(k).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByText('また明日')).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/0/);
        await userEvent.click(k);
        expect(postGachaPull).not.toHaveBeenCalled();
    });

    it('shows the gentle empty copy when nothing can be drawn', async () => {
        vi.mocked(fetchGacha).mockResolvedValue(gachaState({ available: false }));
        const { container } = renderPage();
        expect(await screen.findByText('ガチャに入れる思い出が、まだありません。')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'ハンドルを回す' })).toBeNull();
        expect(container.textContent).not.toMatch(/0/);
    });

    it("opens today's newest pull on load and reopens an older card from the history", async () => {
        const todays = gachaPull({ pull_index: 0 }, { id: 1, text: '今日の一枚' });
        const older = gachaPull({ jst_date: '2026-11-09', pull_index: 2, rarity: 'r', reason: 'nickname' }, { id: 2, text: '昨日の一枚' });
        vi.mocked(fetchGacha).mockResolvedValue(gachaState({ pulls_left: 2, today: [todays], history: [todays, older] }));
        renderPage();
        expect(await screen.findByText('今日の一枚')).toBeInTheDocument();
        const items = within(screen.getByRole('list', { name: 'これまでに出た思い出' })).getAllByRole('button');
        await userEvent.click(items[1]!);
        expect(screen.getByText('昨日の一枚')).toBeInTheDocument();
        expect(screen.getByTestId('gacha-card')).toHaveAttribute('data-rarity', 'r');
    });

    it('★ is optimistic, reverts when the server says success: false, and logs', async () => {
        const pending = deferred<boolean>();
        vi.mocked(setFavorite).mockReturnValue(pending.promise);
        vi.mocked(fetchGacha).mockResolvedValue(gachaState({ today: [gachaPull()], history: [gachaPull()] }));
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: '★をつける' }));
        expect(setFavorite).toHaveBeenCalledWith('hinatazaka46', 123, true, expect.any(AbortSignal));
        expect(screen.getByRole('button', { name: '★をはずす' })).toHaveAttribute('aria-pressed', 'true');
        await act(async () => { pending.resolve(false); });
        expect(screen.getByRole('button', { name: '★をつける' })).toHaveAttribute('aria-pressed', 'false');
        await waitFor(() => expect(gachaLogs()).toContainEqual({ phase: 'favorite', outcome: 'on', reason: 'request_failed', message_id: 123 }));
    });

    it('★ that saves stays lit across reopening the card and logs the outcome', async () => {
        const a = gachaPull({ pull_index: 0 }, { id: 1, text: 'いちまいめ' });
        const b = gachaPull({ jst_date: '2026-11-09' }, { id: 2, text: 'にまいめ' });
        vi.mocked(fetchGacha).mockResolvedValue(gachaState({ today: [a], history: [a, b] }));
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: '★をつける' }));
        await waitFor(() => expect(gachaLogs()).toContainEqual({ phase: 'favorite', outcome: 'on', message_id: 1 }));
        const items = within(screen.getByRole('list', { name: 'これまでに出た思い出' })).getAllByRole('button');
        await userEvent.click(items[1]!);
        expect(screen.getByRole('button', { name: '★をつける' })).toBeInTheDocument();
        await userEvent.click(items[0]!);
        expect(screen.getByRole('button', { name: '★をはずす' })).toBeInTheDocument();
    });

    it('the context link opens the film strip at the message on its JST day', async () => {
        // 16:30 UTC on the 13th is 01:30 JST on the 14th.
        const p = gachaPull({}, { id: 321, ts: '2024-09-13T16:30:00Z' });
        vi.mocked(fetchGacha).mockResolvedValue(gachaState({ today: [p], history: [p] }));
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: 'この日の前後を見る' }));
        const strip = screen.getByTestId('film-strip-stub');
        expect(strip).toHaveAttribute('data-focus', '321');
        expect(strip).toHaveAttribute('data-date', '2024-09-14');
        expect(strip).toHaveAttribute('data-member', MEMBER_PATH);
        expect(strip).toHaveAttribute('data-from', 'gacha');
        expect(gachaLogs()).toContainEqual({ phase: 'context', message_id: 321 });
        await userEvent.click(screen.getByRole('button', { name: 'close-strip' }));
        expect(screen.queryByTestId('film-strip-stub')).toBeNull();
    });
    it('refetches silently after a timeout: the machine, card and history stay on screen', async () => {
        const first = gachaPull({ pull_index: 0 }, { id: 1, text: 'いちまいめ' });
        const committed = gachaPull({ pull_index: 1, rarity: 'r', reason: 'voice' }, { id: 2, text: 'にまいめ' });
        const refetch = deferred<GachaStatePayload>();
        vi.mocked(fetchGacha)
            .mockResolvedValueOnce(gachaState({ pulls_left: 2, today: [first], history: [first] }))
            .mockReturnValueOnce(refetch.promise);
        vi.mocked(postGachaPull).mockRejectedValue(new MemoriesTimeoutError());
        renderPage();
        const k = await knob();
        await userEvent.click(k);
        await waitFor(() => expect(fetchGacha).toHaveBeenCalledTimes(2));
        // still the same view while the state is read again; the knob waits for it
        expect(screen.getByRole('button', { name: 'ハンドルを回す' })).toBe(k);
        expect(k).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByText('いちまいめ')).toBeInTheDocument();
        expect(screen.getByRole('list', { name: 'これまでに出た思い出' })).toBeInTheDocument();
        await act(async () => {
            refetch.resolve(gachaState({ pulls_left: 1, today: [first, committed], history: [committed, first] }));
        });
        expect(screen.getByText('今日はあと 1 回')).toBeInTheDocument();
        expect(within(screen.getByRole('list', { name: 'これまでに出た思い出' })).getAllByRole('button')).toHaveLength(2);
        expect(k).toHaveAttribute('aria-disabled', 'false');
        // one visit, one open breadcrumb
        expect(gachaLogs().filter((f) => (f as { phase: string }).phase === 'open')).toEqual([{ phase: 'open', count: 2 }]);
    });

    it('a refetch that fails leaves the view with an inline notice and a retry', async () => {
        vi.mocked(fetchGacha)
            .mockResolvedValueOnce(gachaState({ pulls_left: 2 }))
            .mockRejectedValueOnce(new MemoriesTimeoutError())
            .mockResolvedValueOnce(gachaState({ pulls_left: 1 }));
        vi.mocked(postGachaPull).mockRejectedValue(new MemoriesTimeoutError());
        renderPage();
        await userEvent.click(await knob());
        const notice = await screen.findByRole('status');
        expect(notice).toHaveTextContent('ガチャの結果を確かめられませんでした');
        expect(screen.getByRole('button', { name: 'ハンドルを回す' })).toBeInTheDocument();
        expect(screen.queryByText('読み込めませんでした')).toBeNull();
        await userEvent.click(within(notice).getByRole('button', { name: 'もう一度' }));
        expect(await screen.findByText('今日はあと 1 回')).toBeInTheDocument();
        expect(screen.queryByText('ガチャの結果を確かめられませんでした')).toBeNull();
        expect(fetchGacha).toHaveBeenCalledTimes(3);
    });

    it('follows the reduced-motion setting: the capsule fades and the SR foil holds still', async () => {
        window.matchMedia = vi.fn((q: string) => ({
            matches: q.includes('prefers-reduced-motion'), addEventListener: vi.fn(), removeEventListener: vi.fn(),
        })) as unknown as typeof window.matchMedia;
        vi.mocked(postGachaPull).mockResolvedValue({ status: 'ok', data: pullPayload(gachaPull({ rarity: 'sr', reason: 'birthday' }), 2) });
        renderPage();
        await userEvent.click(await knob());
        expect(await screen.findByTestId('gacha-capsule')).toHaveAttribute('data-motion', 'fade');
        expect(screen.getByTestId('gacha-foil')).toBeInTheDocument();
        expect(screen.queryByTestId('gacha-foil-sweep')).toBeNull();
    });

    it('animates the capsule and sweeps the SR foil without reduced motion', async () => {
        window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
        vi.mocked(postGachaPull).mockResolvedValue({ status: 'ok', data: pullPayload(gachaPull({ rarity: 'sr', reason: 'birthday' }), 2) });
        renderPage();
        await userEvent.click(await knob());
        expect(await screen.findByTestId('gacha-capsule')).toHaveAttribute('data-motion', 'roll');
        expect(screen.getByTestId('gacha-foil-sweep')).toBeInTheDocument();
    });
});
