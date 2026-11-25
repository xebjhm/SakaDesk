import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import { memoriesCapsuleEmpty } from '../../../__tests__/mocks/handlers';
import i18n from '../../../i18n';
import { MEMBER_PANE_WIDTH } from '../shared/MemberPane';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return {
        ...real, fetchMemoirMembers: vi.fn(), fetchMemoirHeader: vi.fn(), fetchMemoirCards: vi.fn(), fetchDay: vi.fn(),
        fetchNameMoments: vi.fn(), fetchTimelineMonths: vi.fn(), fetchTimelineMonth: vi.fn(), fetchDay24: vi.fn(),
    };
});
import {
    fetchDay, fetchDay24, fetchMemoirCards, fetchMemoirHeader, fetchMemoirMembers, fetchNameMoments, fetchTimelineMonth, fetchTimelineMonths,
} from '../api';
import { MEMBER_PATH, memoryMessage } from '../__fixtures__/memories';
import { dayPayload } from '../day/__fixtures__';
import type { MemoriesRoute } from '../MemoriesFeature';
import { NicknameProvider } from '../shared/useNickname';
import { clientLog } from '../../../utils/clientLog';
import { MemoirPage } from './MemoirPage';
import { binderPayload, card, face, headerPayload, membersPayload, NAO_PATH } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('ja'); });
// MessageBubble asks for cached translations and transcripts of what it shows.
beforeEach(() => {
    // An opened card reads the fan's capsule notes on it (none here).
    server.use(...memoriesCapsuleEmpty);
    server.use(
        http.get('/api/app-state/translations', () => HttpResponse.json({})),
        http.patch('/api/app-state/translations', () => HttpResponse.json({})),
        http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })),
    );
});
beforeEach(() => {
    vi.mocked(fetchMemoirMembers).mockReset().mockResolvedValue(membersPayload());
    vi.mocked(fetchMemoirHeader).mockReset().mockResolvedValue(headerPayload());
    vi.mocked(fetchMemoirCards).mockReset().mockResolvedValue(binderPayload());
    vi.mocked(fetchDay).mockReset().mockResolvedValue(dayPayload());
    vi.mocked(fetchNameMoments).mockReset().mockResolvedValue({
        years: [2024], items: [{ message: memoryMessage(), sentence: '%%%、おはよう🌸' }],
    });
    vi.mocked(fetchDay24).mockReset().mockResolvedValue({ slots: [] });
    vi.mocked(fetchTimelineMonths).mockReset().mockResolvedValue({ months: [{ month: '2024-09', count: 3 }] });
    vi.mocked(fetchTimelineMonth).mockReset().mockResolvedValue({
        month: '2024-09', count: 3, avatar_url: null, photos: [], hero: null,
        messages: { top: null, late: null, nickname: null }, milestones: [],
    });
});

type MemoirRoute = Extract<MemoriesRoute, { page: 'memoir' }>;

function renderPage(route: MemoirRoute = { page: 'memoir' }) {
    const go = vi.fn();
    const ui = (r: MemoirRoute) => (
        <NicknameProvider nickname="みーぱん"><MemoirPage service="hinatazaka46" route={r} go={go} /></NicknameProvider>
    );
    const utils = render(ui(route));
    return { go, rerender: (next: MemoirRoute) => utils.rerender(ui(next)) };
}

describe('MemoirPage', () => {
    it('lists the members oshi first with binder progress and selects the first one', async () => {
        renderPage();
        expect(screen.getByRole('heading', { name: 'メンバーの思い出' })).toBeInTheDocument();
        const miku = await screen.findByRole('button', { name: /金村 美玖/ });
        expect(miku).toHaveTextContent('18 / 30 枚');
        expect(within(miku).getByTestId('member-pane-oshi')).toBeInTheDocument();
        expect(miku).toHaveAttribute('aria-current', 'true');
        // N2: the same pane width as album, favorites and radio (no fixed w-64).
        const pane = miku.closest('nav');
        expect(pane).toHaveClass(MEMBER_PANE_WIDTH);
        expect(pane).not.toHaveClass('w-64');
        // never "0 / 24 枚"
        expect(screen.getByRole('button', { name: /小坂 菜緒/ })).not.toHaveTextContent('枚');
        // a graduated member wears a quiet memorial marker
        expect(within(screen.getByRole('button', { name: /潮 紗理菜/ })).getByTestId('memoir-graduated')).toHaveClass('text-muted');

        await waitFor(() => expect(vi.mocked(fetchMemoirHeader).mock.calls[0]?.[1]).toBe(MEMBER_PATH));
        expect(vi.mocked(fetchMemoirCards).mock.calls[0]?.[1]).toBe(MEMBER_PATH);
        expect(await screen.findByRole('heading', { name: '金村 美玖' })).toBeInTheDocument();
        expect(await screen.findAllByTestId('binder-shelf')).not.toHaveLength(0);
        expect(screen.getByRole('button', { name: '生写真帳' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('routes to a picked member and loads her header and binder', async () => {
        const { go, rerender } = renderPage();
        await userEvent.click(await screen.findByRole('button', { name: /小坂 菜緒/ }));
        expect(go).toHaveBeenCalledWith({ page: 'memoir', memberPath: NAO_PATH });
        rerender({ page: 'memoir', memberPath: NAO_PATH });
        await waitFor(() => expect(vi.mocked(fetchMemoirHeader).mock.lastCall?.[1]).toBe(NAO_PATH));
        await waitFor(() => expect(vi.mocked(fetchMemoirCards).mock.lastCall?.[1]).toBe(NAO_PATH));
    });

    it('switches tabs through the route and the names chip opens the names tab', async () => {
        const { go } = renderPage({ page: 'memoir', memberPath: MEMBER_PATH });
        await userEvent.click(screen.getByRole('button', { name: 'タイムライン' }));
        expect(go).toHaveBeenCalledWith({ page: 'memoir', memberPath: MEMBER_PATH, tab: 'timeline' });
        await userEvent.click(await screen.findByRole('button', { name: '名前を呼んでくれた 57 回' }));
        expect(go).toHaveBeenCalledWith({ page: 'memoir', memberPath: MEMBER_PATH, tab: 'names' });
    });

    it('holds the header place while it loads', async () => {
        vi.mocked(fetchMemoirHeader).mockReturnValue(new Promise(() => {}));
        renderPage({ page: 'memoir', memberPath: MEMBER_PATH });
        expect(screen.getByTestId('memoir-header-loading')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '生写真帳' })).toBeInTheDocument();
        // let the member list and the binder settle inside the test
        expect(await screen.findByRole('button', { name: /小坂 菜緒/ })).toBeInTheDocument();
        expect(await screen.findAllByTestId('binder-shelf')).not.toHaveLength(0);
    });

    it('opens the card detail on an earned card', async () => {
        renderPage({ page: 'memoir', memberPath: MEMBER_PATH });
        await userEvent.click(await screen.findByRole('button', { name: '最初のメッセージ' }));
        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        // the JST day of the card's message (12:52 UTC on 2024-09-14 is 21:52 JST that day)
        await waitFor(() => expect(vi.mocked(fetchDay).mock.calls[0]?.[1]).toEqual({ date: '2024-09-14', member: MEMBER_PATH }));
    });

    it('draws the names tab and goes back to the binder from it', async () => {
        const { go } = renderPage({ page: 'memoir', memberPath: MEMBER_PATH, tab: 'names' });
        expect(await screen.findByRole('heading', { name: '名前を呼ばれた瞬間' })).toBeInTheDocument();
        expect(await screen.findAllByTestId('name-moment')).toHaveLength(1);
        expect(vi.mocked(fetchNameMoments).mock.calls[0]?.[1]).toBe(MEMBER_PATH);
        expect(vi.mocked(fetchMemoirCards)).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: '生写真帳へ' }));
        expect(go).toHaveBeenCalledWith({ page: 'memoir', memberPath: MEMBER_PATH, tab: 'binder' });
    });

    it('draws the timeline tab', async () => {
        renderPage({ page: 'memoir', memberPath: MEMBER_PATH, tab: 'timeline' });
        expect(screen.getByRole('button', { name: 'タイムライン' })).toHaveAttribute('aria-pressed', 'true');
        expect(await screen.findByRole('slider', { name: '月をえらぶ' })).toBeInTheDocument();
        expect(await screen.findByRole('heading', { name: '2024年9月' })).toBeInTheDocument();
        await waitFor(() => expect(vi.mocked(fetchTimelineMonth).mock.calls[0]?.[2]).toBe('2024-09'));
    });

    it('the 彼女の24時間 chip routes to the day24 tab', async () => {
        const { go } = renderPage({ page: 'memoir', memberPath: MEMBER_PATH });
        await userEvent.click(await screen.findByRole('button', { name: '彼女の24時間' }));
        expect(go).toHaveBeenCalledWith({ page: 'memoir', memberPath: MEMBER_PATH, tab: 'day24' });
    });

    it('draws her 24 hours on the day24 tab with neither tab pill selected', async () => {
        renderPage({ page: 'memoir', memberPath: MEMBER_PATH, tab: 'day24' });
        expect(await screen.findByText('もう少しメッセージが届いたら、ここに一日ができます。')).toBeInTheDocument();
        expect(vi.mocked(fetchDay24).mock.calls[0]?.slice(0, 2)).toEqual(['hinatazaka46', MEMBER_PATH]);
        expect(screen.getByRole('button', { name: '生写真帳' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'タイムライン' })).toHaveAttribute('aria-pressed', 'false');
        expect(vi.mocked(fetchMemoirCards)).not.toHaveBeenCalled();
    });

    describe('card focus (a notification deep link)', () => {
        function withAnniversary() {
            const payload = binderPayload();
            payload.shelves.push({
                key: 'anniversary',
                cards: [card({ key: 'anniv.y1', date: '2025-07-24', face: face({ id: 50, text: '1年ありがとう' }) })],
            });
            return payload;
        }

        it('opens the routed card detail after the binder loads, once per link', async () => {
            vi.mocked(clientLog).mockClear();
            vi.mocked(fetchMemoirCards).mockResolvedValue(withAnniversary());
            const linked: MemoirRoute = { page: 'memoir', memberPath: MEMBER_PATH, tab: 'binder', cardKey: 'anniv.y1' };
            const { rerender } = renderPage(linked);
            const dialog = await screen.findByRole('dialog');
            expect((await within(dialog).findAllByText(/1年ありがとう/)).length).toBeGreaterThan(0);
            await userEvent.keyboard('{Escape}');
            await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
            // the same link re-rendered never re-opens it
            rerender(linked);
            await new Promise((r) => setTimeout(r, 20));
            expect(screen.queryByRole('dialog')).toBeNull();
            expect(clientLog).not.toHaveBeenCalledWith('memories_skip', expect.anything());
            // a repeat toast click is a new link (a new route) to the same card: it opens again
            rerender({ ...linked });
            expect(await screen.findByRole('dialog')).toBeInTheDocument();
        });

        it('refetches an already open binder for a link, so a card earned since then opens', async () => {
            vi.mocked(clientLog).mockClear();
            const plain: MemoirRoute = { page: 'memoir', memberPath: MEMBER_PATH, tab: 'binder' };
            const { rerender } = renderPage(plain);
            expect(await screen.findAllByTestId('binder-shelf')).not.toHaveLength(0);
            const loads = () => vi.mocked(fetchMemoirCards).mock.calls.filter((c) => c[1] === MEMBER_PATH).length;
            const before = loads();
            // midnight passed: her 1-year card is earned now, and the toast links to it
            vi.mocked(fetchMemoirCards).mockResolvedValue(withAnniversary());
            const linked: MemoirRoute = { ...plain, cardKey: 'anniv.y1' };
            rerender(linked);
            const dialog = await screen.findByRole('dialog');
            expect((await within(dialog).findAllByText(/1年ありがとう/)).length).toBeGreaterThan(0);
            expect(loads()).toBe(before + 1);
            expect(clientLog).not.toHaveBeenCalledWith('memories_skip', expect.anything());
            // a re-render of the same link does not load again
            rerender(linked);
            await new Promise((r) => setTimeout(r, 20));
            expect(loads()).toBe(before + 1);
        });

        it('logs card_missing again for a repeat link to an unknown card', async () => {
            vi.mocked(clientLog).mockClear();
            const linked: MemoirRoute = { page: 'memoir', memberPath: MEMBER_PATH, tab: 'binder', cardKey: 'anniv.y9' };
            const { rerender } = renderPage(linked);
            const missing = () => vi.mocked(clientLog).mock.calls.filter((c) => c[0] === 'memories_skip' && (c[1] as { reason?: string }).reason === 'card_missing');
            await waitFor(() => expect(missing()).toHaveLength(1));
            rerender(linked);
            await new Promise((r) => setTimeout(r, 20));
            expect(missing()).toHaveLength(1);
            rerender({ ...linked });
            await waitFor(() => expect(missing()).toHaveLength(2));
        });

        it('logs card_missing for an unknown card and shows the binder', async () => {
            vi.mocked(clientLog).mockClear();
            renderPage({ page: 'memoir', memberPath: MEMBER_PATH, tab: 'binder', cardKey: 'anniv.y9' });
            expect(await screen.findAllByTestId('binder-shelf')).not.toHaveLength(0);
            await waitFor(() => expect(clientLog).toHaveBeenCalledWith('memories_skip', { target: 'binder', reason: 'card_missing' }));
            expect(screen.queryByRole('dialog')).toBeNull();
            expect(vi.mocked(clientLog).mock.calls.filter((c) => c[0] === 'memories_skip')).toHaveLength(1);
        });

        it('treats an unearned card as missing', async () => {
            vi.mocked(clientLog).mockClear();
            renderPage({ page: 'memoir', memberPath: MEMBER_PATH, tab: 'binder', cardKey: 'first.picture' });
            await waitFor(() => expect(clientLog).toHaveBeenCalledWith('memories_skip', { target: 'binder', reason: 'card_missing' }));
            expect(screen.queryByRole('dialog')).toBeNull();
        });

        it('a tab or member pick drops the card key', async () => {
            const { go } = renderPage({ page: 'memoir', memberPath: MEMBER_PATH, tab: 'binder', cardKey: 'anniv.y9' });
            await userEvent.click(screen.getByRole('button', { name: 'タイムライン' }));
            expect(go).toHaveBeenLastCalledWith({ page: 'memoir', memberPath: MEMBER_PATH, tab: 'timeline' });
            await userEvent.click(await screen.findByRole('button', { name: /小坂 菜緒/ }));
            expect(go).toHaveBeenLastCalledWith({ page: 'memoir', memberPath: NAO_PATH });
        });
    });
});
