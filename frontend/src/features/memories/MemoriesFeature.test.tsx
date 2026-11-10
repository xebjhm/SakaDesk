import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { SERVICE_FEATURES, getAvailableFeatures } from '../../config/features';
import { MemoriesFeature } from './MemoriesFeature';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

beforeAll(async () => { await i18n.changeLanguage('en'); });
let shelf: number[] | null = [2025];
let membersYears: number[] = [];
beforeEach(() => {
    shelf = [2025];
    membersYears = [];
    server.use(
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

    it('resets to home when the service changes', async () => {
        const { rerender } = render(<MemoriesFeature service="hinatazaka46" />);
        await userEvent.click(await screen.findByRole('button', { name: /Year recap/ }));
        expect(screen.getByTestId('recap-entry')).toBeInTheDocument();
        rerender(<MemoriesFeature service="sakurazaka46" />);
        expect(screen.getByTestId('memories-home')).toBeInTheDocument();
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
            expect(screen.queryByRole('button')).toBeNull();
            expect(screen.getByTestId('memories-home').textContent).not.toMatch(/20\d\d/);
            release();
            // The shelf's newest year (not the default 2025) is what opens.
            const card = await screen.findByRole('button', { name: /Year recap/ });
            expect(card).toHaveTextContent('2023');
            expect(screen.queryByTestId('memories-recap-loading')).toBeNull();
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
