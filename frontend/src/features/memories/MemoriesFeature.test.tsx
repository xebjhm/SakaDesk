import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { SERVICE_FEATURES, getAvailableFeatures } from '../../config/features';
import { MemoriesFeature } from './MemoriesFeature';
import { hubPayload } from './home/__fixtures__';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';
// The real client, wrapped so a test can make one poll come back `skipped`.
vi.mock('./recap/api', async (importOriginal) => {
    const real = await importOriginal<typeof import('./recap/api')>();
    return { ...real, fetchRecapYears: vi.fn(real.fetchRecapYears) };
});
import { fetchRecapYears } from './recap/api';

beforeAll(async () => { await i18n.changeLanguage('en'); });
let shelf: number[] | null = [2025];
let membersYears: number[] = [];
beforeEach(() => {
    shelf = [2025];
    membersYears = [];
    server.use(
        http.get('/api/memories/:service/on-this-day', ({ request }) => (
            HttpResponse.json({ month_day: new URL(request.url).searchParams.get('date'), years: [] })
        )),
        // The album page (C9) loads its list, months and ribbon.
        http.get('/api/memories/:service/album/members', () => HttpResponse.json({ total: 0, members: [] })),
        http.get('/api/memories/:service/album/months', () => HttpResponse.json({ months: [] })),
        http.get('/api/memories/:service/album/colors', () => HttpResponse.json({ colors: {} })),
        // The favorites page (C10) loads its board.
        http.get('/api/memories/:service/favorites', () => HttpResponse.json({ total: 0, members: [], items: [] })),
        // The hub board (C13) loads its moment, counts and countdown.
        http.get('/api/memories/:service/hub', () => HttpResponse.json(hubPayload())),
        // The memoir page (C11) loads its member list.
        http.get('/api/memories/:service/memoir/members', () => HttpResponse.json({ members: [] })),
        http.get('/api/memories/:service/recap/years', () => (
            shelf ? HttpResponse.json({ years: shelf }) : HttpResponse.json({ detail: 'x' }, { status: 500 })
        )),
        http.get('/api/memories/:service/recap/:year/members', ({ params }) => {
            membersYears.push(Number(params.year));
            return HttpResponse.json({
                year: Number(params.year), phase: 'partial', christmas_open: false, members: [],
                opening: { star_order: [], first_message: null, oyasumi_total: null },
            });
        }),
    );
});
afterEach(() => { vi.useRealTimers(); });

/** Freeze the clock at a JST wall-clock instant (only `Date`, so msw and user-event keep their timers). */
const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${iso}+09:00`));
};

describe('Memories feature', () => {
    it('is offered for every service', () => {
        for (const service of [...Object.keys(SERVICE_FEATURES), 'someunknown']) {
            expect(getAvailableFeatures(service).map(f => f.id)).toContain('memories');
        }
    });

    it('opens on the home hub with the recap card', async () => {
        render(<MemoriesFeature service="hinatazaka46" />);
        expect(screen.getByTestId('memories-home')).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: /Year recap/ })).toBeInTheDocument();
    });

    it('switches to the recap page when the recap card is clicked', async () => {
        render(<MemoriesFeature service="hinatazaka46" />);
        await userEvent.click(await screen.findByRole('button', { name: /Year recap/ }));
        expect(screen.getByTestId('recap-entry')).toBeInTheDocument();
        expect(screen.queryByTestId('memories-home')).toBeNull();
    });

    it.each([
        [/Album/, 'memories-page-album'],
        [/Member memories/, 'memories-page-memoir'],
        [/Favorites/, 'memories-page-favorites'],
    ])('a hub card (%s) lands on its page', async (name, testId) => {
        render(<MemoriesFeature service="hinatazaka46" />);
        await userEvent.click(await screen.findByRole('button', { name }));
        expect(screen.getByTestId(testId)).toBeInTheDocument();
        expect(screen.queryByTestId('memories-home')).toBeNull();
    });

    it('the On This Day card lands on the On This Day page', async () => {
        render(<MemoriesFeature service="hinatazaka46" />);
        await userEvent.click(await screen.findByTestId('memories-hub-otd'));
        expect(screen.getByTestId('memories-page-onThisDay')).toBeInTheDocument();
    });

    it('resets to home when the service changes', async () => {
        const { rerender } = render(<MemoriesFeature service="hinatazaka46" />);
        await userEvent.click(await screen.findByRole('button', { name: /Year recap/ }));
        expect(screen.getByTestId('recap-entry')).toBeInTheDocument();
        rerender(<MemoriesFeature service="sakurazaka46" />);
        expect(screen.getByTestId('memories-home')).toBeInTheDocument();
    });

    describe('core pages', () => {
        const PAGES = [
            { route: { page: 'onThisDay', monthDay: '09-14' }, testId: 'memories-page-onThisDay', title: 'On this day, years ago' },
            { route: { page: 'album', memberPath: 'x' }, testId: 'memories-page-album', title: 'Album' },
            { route: { page: 'memoir', tab: 'binder' }, testId: 'memories-page-memoir', title: 'Member memories' },
            { route: { page: 'favorites' }, testId: 'memories-page-favorites', title: 'Favorites' },
        ] as const;

        it.each(PAGES)('opens the $route.page page with its header and returns home', async ({ route, testId, title }) => {
            vi.mocked(clientLog).mockClear();
            render(<MemoriesFeature service="hinatazaka46" initialRoute={route} />);
            const page = screen.getByTestId(testId);
            expect(page).toHaveAttribute('data-service', 'hinatazaka46');
            expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
            expect(screen.queryByTestId('memories-home')).toBeNull();
            await userEvent.click(screen.getByRole('button', { name: 'Back' }));
            expect(screen.getByTestId('memories-home')).toBeInTheDocument();
            expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_page', { target: 'home' });
        });

        it('logs the page it opens on from a deep link', () => {
            vi.mocked(clientLog).mockClear();
            render(<MemoriesFeature service="hinatazaka46" initialRoute={{ page: 'album' }} />);
            expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_page', { target: 'album' });
        });

        it('stays home after switching service and back', () => {
            const { rerender } = render(<MemoriesFeature service="hinatazaka46" initialRoute={{ page: 'favorites' }} />);
            rerender(<MemoriesFeature service="sakurazaka46" initialRoute={{ page: 'favorites' }} />);
            rerender(<MemoriesFeature service="hinatazaka46" initialRoute={{ page: 'favorites' }} />);
            expect(screen.getByTestId('memories-home')).toBeInTheDocument();
            expect(screen.queryByTestId('memories-page-favorites')).toBeNull();
        });

        it.each(PAGES)('resets the $route.page page to home when the service changes', ({ route, testId }) => {
            const { rerender } = render(<MemoriesFeature service="hinatazaka46" initialRoute={route} />);
            expect(screen.getByTestId(testId)).toBeInTheDocument();
            rerender(<MemoriesFeature service="sakurazaka46" initialRoute={route} />);
            expect(screen.getByTestId('memories-home')).toBeInTheDocument();
            expect(screen.queryByTestId(testId)).toBeNull();
        });
    });

    describe('fun-wave routes (placeholders until their tasks)', () => {
        const FUN = [
            { route: { page: 'radio' }, testId: 'memories-page-radio', title: 'Voice radio', code: 'radio' },
            { route: { page: 'gacha' }, testId: 'memories-page-gacha', title: 'Memory gacha', code: 'gacha' },
            { route: { page: 'calendar', month: '2024-09' }, testId: 'memories-page-calendar', title: 'Calendar', code: 'calendar' },
            // JST midnight on Jan 1: a title formatted in UTC would read "Dec 31, 2023".
            { route: { page: 'day', date: '2024-01-01' }, testId: 'memories-page-day', title: 'Jan 1, 2024', code: 'day' },
        ] as const;

        it.each(FUN)('opens the $route.page placeholder, logs its snake_case code and returns home', async ({ route, testId, title, code }) => {
            vi.mocked(clientLog).mockClear();
            render(<MemoriesFeature service="hinatazaka46" initialRoute={route} />);
            expect(screen.getByTestId(testId)).toHaveAttribute('data-service', 'hinatazaka46');
            expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
            expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_page', { target: code });
            await userEvent.click(screen.getByRole('button', { name: 'Back' }));
            expect(screen.getByTestId('memories-home')).toBeInTheDocument();
        });

        it.each(FUN)('resets the $route.page page to home when the service changes', ({ route, testId }) => {
            const { rerender } = render(<MemoriesFeature service="hinatazaka46" initialRoute={route} />);
            expect(screen.getByTestId(testId)).toBeInTheDocument();
            rerender(<MemoriesFeature service="sakurazaka46" initialRoute={route} />);
            expect(screen.getByTestId('memories-home')).toBeInTheDocument();
            expect(screen.queryByTestId(testId)).toBeNull();
        });

        it('a day opened from the calendar goes back to the calendar', async () => {
            render(<MemoriesFeature service="hinatazaka46" initialRoute={{ page: 'day', date: '2024-09-14', from: 'calendar' }} />);
            await userEvent.click(screen.getByRole('button', { name: 'Back' }));
            expect(screen.getByTestId('memories-page-calendar')).toBeInTheDocument();
        });

        it('the memoir accepts the day24 tab and draws its placeholder', async () => {
            server.use(http.get('/api/memories/:service/memoir', () => HttpResponse.json({
                member_path: 'x', name: '金村 美玖', avatar_url: null, graduated: false,
                chips: { subscription_days: null, nickname_count: null, voice_seconds: null },
            })));
            render(<MemoriesFeature service="hinatazaka46" initialRoute={{ page: 'memoir', memberPath: 'x', tab: 'day24' }} />);
            expect(await screen.findByTestId('memories-day24-placeholder')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Her 24 hours' })).toBeInTheDocument();
        });
    });

    describe('year-end unlocks (JST)', () => {
        it('before Dec 1 opens the newest past year on the shelf', async () => {
            at('2026-11-30T23:59:00');
            shelf = [2024, 2025];
            render(<MemoriesFeature service="hinatazaka46" />);
            const card = await screen.findByRole('button', { name: /Year recap/ });
            await waitFor(() => expect(card).toHaveTextContent('2025'));
            await userEvent.click(card);
            await waitFor(() => expect(membersYears).toEqual([2025]));
            // The chooser offers the shelf only: the current year is still closed.
            expect(screen.getByRole('button', { name: 'Next year' }).parentElement).toHaveClass('invisible');
        });

        it('before Dec 1 with no past year shows a gentle "opens on 12/1" card, never a 0', async () => {
            at('2026-11-10T12:00:00');
            shelf = [];
            render(<MemoriesFeature service="hinatazaka46" />);
            expect(await screen.findByText('Opens here on December 1.')).toBeInTheDocument();
            expect(screen.queryByTestId('memories-recap-loading')).toBeNull();
            expect(screen.queryByTestId('memories-recap-failed')).toBeNull();
            expect(screen.queryByRole('button', { name: /Year recap/ })).toBeNull();
            expect(screen.getByTestId('memories-home').textContent).not.toMatch(/\b0\b/);
        });

        it('from Dec 1 opens the current year as "so far"', async () => {
            at('2026-12-01T00:00:00');
            shelf = [];
            render(<MemoriesFeature service="hinatazaka46" />);
            const card = await screen.findByRole('button', { name: /Year recap/ });
            expect(card).toHaveTextContent('2026, so far');
            await userEvent.click(card);
            await waitFor(() => expect(membersYears).toEqual([2026]));
        });

        it('from Jan 1 shows the year just ended first', async () => {
            at('2027-01-01T00:00:00');
            shelf = [2025, 2026];
            render(<MemoriesFeature service="hinatazaka46" />);
            const card = await screen.findByRole('button', { name: /Year recap/ });
            await waitFor(() => expect(card).toHaveTextContent('2026'));
            expect(card).not.toHaveTextContent('so far');
            await userEvent.click(card);
            await waitFor(() => expect(membersYears).toEqual([2026]));
        });

        it('while the shelf loads shows a neutral card with no year to open', async () => {
            at('2026-11-30T12:00:00');
            shelf = [2023];
            let release: () => void = () => {};
            const gate = new Promise<void>((r) => { release = r; });
            server.use(http.get('/api/memories/:service/recap/years', async () => {
                await gate;
                return HttpResponse.json({ years: shelf });
            }));
            render(<MemoriesFeature service="hinatazaka46" />);
            const loading = screen.getByTestId('memories-recap-loading');
            expect(loading).toHaveTextContent('Loading');
            // The recap card is not clickable (the hub's other cards are, C13).
            expect(screen.queryByRole('button', { name: /Year recap/ })).toBeNull();
            expect(screen.getByTestId('memories-home').textContent).not.toMatch(/20\d\d/);
            release();
            // The shelf's newest year (not the default 2025) is what opens.
            const card = await screen.findByRole('button', { name: /Year recap/ });
            expect(card).toHaveTextContent('2023');
            expect(screen.queryByTestId('memories-recap-loading')).toBeNull();
        });

        it('when the shelf poll is skipped shows a retry and logs it, never an endless spinner', async () => {
            at('2026-11-10T12:00:00');
            vi.mocked(clientLog).mockClear();
            vi.mocked(fetchRecapYears).mockResolvedValueOnce({ status: 'skipped' });
            render(<MemoriesFeature service="hinatazaka46" />);
            expect(await screen.findByTestId('memories-recap-failed')).toBeInTheDocument();
            expect(screen.queryByTestId('memories-recap-loading')).toBeNull();
            expect(vi.mocked(clientLog)).toHaveBeenCalledWith('recap_load', { target: 'years', outcome: 'skipped' });
            await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
            expect(await screen.findByRole('button', { name: /Year recap/ })).toHaveTextContent('2025');
        });

        it('when the shelf fails shows a retry, never an unconfirmed year', async () => {
            at('2026-11-10T12:00:00');
            shelf = null;
            render(<MemoriesFeature service="hinatazaka46" />);
            const failed = await screen.findByTestId('memories-recap-failed');
            expect(failed).toHaveTextContent('Could not load the recap.');
            expect(screen.queryByRole('button', { name: /Year recap/ })).toBeNull();
            shelf = [2024];
            await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
            const card = await screen.findByRole('button', { name: /Year recap/ });
            expect(card).toHaveTextContent('2024');
            await userEvent.click(card);
            await waitFor(() => expect(membersYears).toEqual([2024]));
        });

        it('before Dec 1 opens the shelf year even when it is not the default year', async () => {
            at('2026-11-30T23:59:00');
            shelf = [2023];
            render(<MemoriesFeature service="hinatazaka46" />);
            const card = await screen.findByRole('button', { name: /Year recap/ });
            expect(card).toHaveTextContent('2023');
            await userEvent.click(card);
            await waitFor(() => expect(membersYears).toEqual([2023]));
            // 2024 and 2025 have no recap: the chooser cannot step to them.
            expect(screen.getByRole('button', { name: 'Next year' }).parentElement).toHaveClass('invisible');
        });

        it('from Jan 1 opens the newest shelf year when the year just ended has none', async () => {
            at('2027-01-01T00:00:00');
            shelf = [2024];
            render(<MemoriesFeature service="hinatazaka46" />);
            const card = await screen.findByRole('button', { name: /Year recap/ });
            expect(card).toHaveTextContent('2024');
        });
    });
});
