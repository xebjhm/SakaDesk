import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchFavorites: vi.fn(), fetchDay: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { fetchDay, fetchFavorites } from '../api';
import { NicknameProvider } from '../shared/useNickname';
import type { MemoriesRoute } from '../MemoriesFeature';
import { dayMessage, dayPayload, MIKU } from '../day/__fixtures__';
import { FavoritesPage } from './FavoritesPage';
import { favoritesPayload, MEMBER_PATH, NAO_PATH, NOTE } from './__fixtures__';
import { useVoicePlayback } from '../shared/voicePlayback';

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    vi.mocked(fetchFavorites).mockReset().mockResolvedValue(favoritesPayload());
    vi.mocked(fetchDay).mockReset().mockResolvedValue(dayPayload({
        members: [MIKU],
        messages: [
            dayMessage(MIKU, { id: 10, ts: '2024-09-14T11:00:00Z', text: 'まえのメッセージ' }),
            dayMessage(MIKU, { id: 11, ts: '2024-09-14T12:52:00Z', text: NOTE.text, favorited: true }),
            dayMessage(MIKU, { id: 14, ts: '2024-09-14T14:00:00Z', text: 'つぎのメッセージ' }),
        ],
    }));
});

type FavoritesRoute = Extract<MemoriesRoute, { page: 'favorites' }>;

function renderPage(route: FavoritesRoute = { page: 'favorites' }) {
    const go = vi.fn();
    const ui = (r: FavoritesRoute) => (
        <NicknameProvider nickname="みーぱん">
            <FavoritesPage service="hinatazaka46" route={r} go={go} />
        </NicknameProvider>
    );
    const utils = render(ui(route));
    return { go, rerender: (next: FavoritesRoute) => utils.rerender(ui(next)) };
}

describe('FavoritesPage', () => {
    it('lists every favourite with counts and refetches for a picked member', async () => {
        const { go, rerender } = renderPage();
        await screen.findByTestId('cork-board');
        expect(screen.getByRole('heading', { name: 'Favorites' })).toBeInTheDocument();
        const all = screen.getByRole('button', { name: /All favorites/ });
        expect(all).toHaveAttribute('aria-current', 'true');
        expect(all).toHaveTextContent('4');
        expect(screen.getByRole('button', { name: /小坂 菜緒/ })).toHaveTextContent('1');
        expect(vi.mocked(fetchFavorites).mock.calls[0]?.[1]).toBeUndefined();

        await userEvent.click(screen.getByRole('button', { name: /小坂 菜緒/ }));
        expect(go).toHaveBeenCalledWith({ page: 'favorites', memberPath: NAO_PATH });
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'member_filter', outcome: 'on' });

        rerender({ page: 'favorites', memberPath: NAO_PATH });
        await waitFor(() => expect(vi.mocked(fetchFavorites).mock.lastCall?.[1]).toBe(NAO_PATH));
        // The list stays while the board reloads.
        expect(screen.getByRole('button', { name: /小坂 菜緒/ })).toHaveAttribute('aria-current', 'true');
    });

    it('opens the film strip on the clicked favourite, centred between its neighbours', async () => {
        renderPage();
        await userEvent.click(await screen.findByTestId('cork-note-11'));
        const focus = await screen.findByTestId('film-focus');
        expect(focus).toHaveTextContent('みーぱんの声');
        expect(vi.mocked(fetchDay).mock.calls[0]?.[1]).toEqual({ date: '2024-09-14', member: MEMBER_PATH });
        const frames = screen.getAllByTestId('film-frame');
        expect(frames).toHaveLength(3);
        expect(frames[0]).toHaveTextContent('まえのメッセージ');
        expect(frames[2]).toHaveTextContent('つぎのメッセージ');
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'film_strip', outcome: 'on' });

        await userEvent.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByTestId('film-focus')).toBeNull());
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'film_strip', outcome: 'off' });
    });

    it('shows the invitation, never a zero, when nothing is starred yet', async () => {
        vi.mocked(fetchFavorites).mockResolvedValue(favoritesPayload({ total: 0, members: [], items: [] }));
        renderPage();
        expect(await screen.findByText('Messages you star with ★ will be pinned up here.')).toBeInTheDocument();
        const page = screen.getByTestId('memories-page-favorites');
        expect(within(page).queryByText('0')).toBeNull();
        expect(page.textContent).not.toMatch(/\b0\b/);
    });

    it('offers a retry when the board cannot be loaded', async () => {
        vi.mocked(fetchFavorites).mockRejectedValueOnce(new Error('x'));
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
        expect(await screen.findByTestId('cork-board')).toBeInTheDocument();
    });

    it('stops a playing board voice when the strip opens, and every voice on leaving', async () => {
        const { unmount } = (() => {
            const r = render(
                <NicknameProvider nickname="みーぱん">
                    <FavoritesPage service="hinatazaka46" route={{ page: 'favorites' }} go={vi.fn()} />
                </NicknameProvider>,
            );
            return r;
        })();
        const voice = await screen.findByTestId('cork-voice-13');
        await userEvent.click(within(voice).getByRole('button', { name: /Play/ }));
        expect(voice.querySelector('audio')).not.toBeNull();
        await userEvent.click(screen.getByTestId('cork-note-11'));
        await screen.findByTestId('film-focus');
        expect(screen.getByTestId('cork-voice-13').querySelector('audio')).toBeNull();

        await userEvent.keyboard('{Escape}');
        await userEvent.click(within(screen.getByTestId('cork-voice-13')).getByRole('button', { name: /Play/ }));
        expect(useVoicePlayback.getState().playing).not.toBeNull();
        unmount();
        expect(useVoicePlayback.getState().playing).toBeNull();
    });
});
