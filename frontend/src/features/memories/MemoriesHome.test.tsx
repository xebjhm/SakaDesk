import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('./home/HubSlots', async (importOriginal) => {
    const real = await importOriginal<typeof import('./home/HubSlots')>();
    return { ...real, HubSlots: vi.fn(real.HubSlots) };
});
vi.mock('./api', async (importOriginal) => {
    const real = await importOriginal<typeof import('./api')>();
    return { ...real, fetchHub: vi.fn() };
});
import { clientLog } from '../../utils/clientLog';
import { fetchHub, MemoriesFetchError } from './api';
import { HubSlots } from './home/HubSlots';
import { MemoriesHome } from './MemoriesHome';
import type { RecapCardState } from './home/RecapHubCard';
import type { MemoriesRoute } from './MemoriesFeature';
import { hubMoment, hubPayload } from './home/__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('en'); });

let go: ReturnType<typeof vi.fn<(next: MemoriesRoute) => void>>;
let onOpenRecap: ReturnType<typeof vi.fn<(year: number) => void>>;
beforeEach(() => {
    go = vi.fn();
    onOpenRecap = vi.fn();
    vi.mocked(fetchHub).mockReset();
    vi.mocked(clientLog).mockClear();
});

const OPEN: RecapCardState = { kind: 'open', year: 2025, partial: false };

const renderHome = (recap: RecapCardState = OPEN) => render(
    <MemoriesHome service="hinatazaka46" recap={recap} onOpenRecap={onOpenRecap} onRetry={vi.fn()} go={go} />,
);

describe('MemoriesHome (hub board)', () => {
    it('shows the On This Day card from the hub payload and logs the load', async () => {
        vi.mocked(fetchHub).mockResolvedValue(hubPayload());
        renderHome();
        const card = await screen.findByTestId('memories-hub-otd');
        expect(card).toHaveTextContent('2 years ago today');
        expect(card).toHaveTextContent('金村 美玖');
        expect(screen.getByRole('heading', { name: 'Memories' })).toBeInTheDocument();
        expect(vi.mocked(fetchHub)).toHaveBeenCalledWith('hinatazaka46', expect.any(AbortSignal));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_load', { target: 'hub', outcome: 'ok', count: 1 });
    });

    it.each([
        ['week', 'This week, 2 years ago'],
        ['first', 'From the early days'],
    ] as const)('uses the %s copy', async (rule, copy) => {
        vi.mocked(fetchHub).mockResolvedValue(hubPayload({ on_this_day: hubMoment({ rule, years_ago: rule === 'first' ? 0 : 2 }) }));
        renderHome();
        const card = await screen.findByTestId('memories-hub-otd');
        expect(card).toHaveTextContent(copy);
        expect(card).not.toHaveTextContent(/today/i);
    });

    it('routes the On This Day card', async () => {
        vi.mocked(fetchHub).mockResolvedValue(hubPayload());
        renderHome();
        await userEvent.click(await screen.findByTestId('memories-hub-otd'));
        expect(go).toHaveBeenCalledWith({ page: 'onThisDay' });
    });

    it('leaves the On This Day card out when there is no moment', async () => {
        vi.mocked(fetchHub).mockResolvedValue(hubPayload({ on_this_day: null }));
        renderHome();
        await screen.findByTestId('memories-hub-countdown');
        expect(screen.queryByTestId('memories-hub-otd')).toBeNull();
    });

    it('shows the entry cards with their counts and routes them', async () => {
        vi.mocked(fetchHub).mockResolvedValue(hubPayload());
        renderHome();
        const album = await screen.findByRole('button', { name: /Album/ });
        await screen.findByText('8,412 photos');
        expect(album).toHaveTextContent('8,412 photos');
        expect(screen.getByRole('button', { name: /Member memories/ })).toHaveTextContent('27 members');
        expect(screen.getByRole('button', { name: /Favorites/ })).toHaveTextContent('96 favorites');
        await userEvent.click(album);
        expect(go).toHaveBeenCalledWith({ page: 'album' });
        await userEvent.click(screen.getByRole('button', { name: /Member memories/ }));
        expect(go).toHaveBeenCalledWith({ page: 'memoir' });
        await userEvent.click(screen.getByRole('button', { name: /Favorites/ }));
        expect(go).toHaveBeenCalledWith({ page: 'favorites' });
    });

    it('hides a zero count, never rendering "0"', async () => {
        vi.mocked(fetchHub).mockResolvedValue(hubPayload({ counts: { album: 0, members: 2, favorites: 0, voices: 0, days: 0 }, countdown: null }));
        renderHome();
        await screen.findByText('2 members');
        const album = screen.getByRole('button', { name: /Album/ });
        expect(album.textContent).not.toMatch(/\d/);
        expect(screen.getByRole('button', { name: /Favorites/ }).textContent).not.toMatch(/\d/);
        expect(screen.getByRole('button', { name: /Voice radio/ }).textContent).not.toMatch(/\d/);
        expect(screen.getByRole('button', { name: /Calendar/ }).textContent).not.toMatch(/\d/);
        expect(screen.getByTestId('memories-home').textContent).not.toMatch(/\b0\b/);
    });

    it('shows the fun-wave cards with their counts and routes them', async () => {
        vi.mocked(fetchHub).mockResolvedValue(hubPayload({ gacha_left: 2 }));
        renderHome();
        await screen.findByText('310 voices');
        expect(screen.getByRole('button', { name: /Voice radio/ })).toHaveTextContent('310 voices');
        expect(screen.getByRole('button', { name: /Memory gacha/ })).toHaveTextContent('2 left today');
        expect(screen.getByRole('button', { name: /Calendar/ })).toHaveTextContent('845 days');
        await userEvent.click(screen.getByRole('button', { name: /Voice radio/ }));
        expect(go).toHaveBeenCalledWith({ page: 'radio' });
        await userEvent.click(screen.getByRole('button', { name: /Memory gacha/ }));
        expect(go).toHaveBeenCalledWith({ page: 'gacha' });
        await userEvent.click(screen.getByRole('button', { name: /Calendar/ }));
        expect(go).toHaveBeenCalledWith({ page: 'calendar' });
    });

    it('formats large fun-wave counts like the core counts (1,234)', async () => {
        vi.mocked(fetchHub).mockResolvedValue(hubPayload({ counts: { album: 8412, members: 27, favorites: 96, voices: 1234, days: 2048 } }));
        renderHome();
        expect(await screen.findByText('1,234 voices')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Calendar/ })).toHaveTextContent('2,048 days');
    });

    it('says "see you tomorrow" on the gacha card when today\'s pulls are used, never 0', async () => {
        vi.mocked(fetchHub).mockResolvedValue(hubPayload({ gacha_left: 0 }));
        renderHome();
        const gacha = await screen.findByText('See you tomorrow');
        expect(screen.getByRole('button', { name: /Memory gacha/ })).toContainElement(gacha);
        expect(screen.getByRole('button', { name: /Memory gacha/ }).textContent).not.toMatch(/\d/);
    });

    it('shows the gacha card without a count when the store failed (null)', async () => {
        vi.mocked(fetchHub).mockResolvedValue(hubPayload({ gacha_left: null }));
        renderHome();
        await screen.findByText('310 voices');
        const gacha = screen.getByRole('button', { name: /Memory gacha/ });
        expect(gacha.textContent).not.toMatch(/\d/);
        expect(gacha).not.toHaveTextContent('See you tomorrow');
    });

    it('still opens the recap from its card', async () => {
        vi.mocked(fetchHub).mockResolvedValue(hubPayload());
        renderHome({ kind: 'open', year: 2026, partial: true });
        const recap = screen.getByRole('button', { name: /Year recap/ });
        expect(recap).toHaveTextContent('2026, so far');
        await userEvent.click(recap);
        expect(onOpenRecap).toHaveBeenCalledWith(2026);
    });

    it('shows the countdown, and hides it for null', async () => {
        vi.mocked(fetchHub).mockResolvedValue(hubPayload());
        const { unmount } = renderHome();
        expect(await screen.findByTestId('memories-hub-countdown')).toHaveTextContent("12 days until 金村 美玖's birthday");
        unmount();
        vi.mocked(fetchHub).mockResolvedValue(hubPayload({ countdown: null }));
        renderHome();
        await screen.findByTestId('memories-hub-otd');
        expect(screen.queryByTestId('memories-hub-countdown')).toBeNull();
    });

    it('keeps the entry cards usable while the hub loads', () => {
        vi.mocked(fetchHub).mockReturnValue(new Promise(() => {}));
        renderHome();
        expect(within(screen.getByTestId('memories-hub-moment')).getByRole('status')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Album/ }).textContent).not.toMatch(/\d/);
    });

    it('offers a retry when the hub fails, and loads again', async () => {
        vi.mocked(fetchHub).mockRejectedValueOnce(new MemoriesFetchError(500)).mockResolvedValue(hubPayload());
        renderHome();
        const retry = await screen.findByRole('button', { name: 'Try again' });
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_load', { target: 'hub', outcome: 'error', error_code: 500 });
        // The other cards stay usable.
        expect(screen.getByRole('button', { name: /Album/ })).toBeInTheDocument();
        await userEvent.click(retry);
        expect(await screen.findByTestId('memories-hub-otd')).toBeInTheDocument();
        expect(vi.mocked(fetchHub)).toHaveBeenCalledTimes(2);
    });

    it('scrolls the whole board (moment and every card) inside the pane, so a short window reaches every card', async () => {
        vi.mocked(fetchHub).mockResolvedValue(hubPayload());
        renderHome();
        await screen.findByTestId('memories-hub-otd');
        const home = screen.getByTestId('memories-home');
        expect(home).toHaveClass('overflow-hidden');
        const board = screen.getByTestId('memories-hub-board');
        // The one scroll container below the title: it may shrink to the pane and scrolls itself.
        expect(board).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
        expect(board.parentElement).toBe(home);
        expect(within(board).getByTestId('memories-hub-otd')).toBeInTheDocument();
        for (const name of [/Album/, /Member memories/, /Favorites/, /Year recap/]) {
            expect(within(board).getByRole('button', { name })).toBeInTheDocument();
        }
        expect(within(board).getByTestId('memories-hub-countdown')).toBeInTheDocument();
        // Nothing inside the board scrolls or clips on its own (one scroll, never a 0-height grid).
        for (const el of board.querySelectorAll('*')) expect(el.className.toString()).not.toMatch(/overflow-y-auto/);
        for (const el of board.children) expect(el.className.toString()).not.toMatch(/\bflex-1\b|min-h-0/);
    });

    it('mounts the wave-4 slots even without an On This Day moment', async () => {
        vi.mocked(HubSlots).mockClear();
        vi.mocked(fetchHub).mockResolvedValue(hubPayload({ on_this_day: null }));
        renderHome();
        await screen.findByTestId('memories-hub-countdown');
        expect(vi.mocked(HubSlots)).toHaveBeenCalled();
        expect(vi.mocked(HubSlots).mock.lastCall?.[0]).toMatchObject({ sameTime: null, capsule: null });
    });
});
