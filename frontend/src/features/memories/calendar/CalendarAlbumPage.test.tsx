import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return {
        ...real,
        fetchCalendarMonths: vi.fn(),
        fetchCalendarMonth: vi.fn(),
        fetchMemoirMembers: vi.fn(),
    };
});
import { clientLog } from '../../../utils/clientLog';
import { fetchCalendarMonth, fetchCalendarMonths, fetchMemoirMembers } from '../api';
import type { MemoriesRoute } from '../MemoriesFeature';
import { membersPayload, NAO_OLD_PATH, NAO_PATH } from '../memoir/__fixtures__';
import { MEMBER_PATH } from '../__fixtures__/memories';
import { CalendarAlbumPage } from './CalendarAlbumPage';
import { monthPayload, monthsPayload } from './__fixtures__';

type CalendarRoute = Extract<MemoriesRoute, { page: 'calendar' }>;

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 2024-09-20 12:00 JST.
    vi.setSystemTime(new Date('2024-09-20T03:00:00Z'));
    vi.mocked(clientLog).mockClear();
    vi.mocked(fetchCalendarMonths).mockReset().mockResolvedValue(monthsPayload());
    vi.mocked(fetchCalendarMonth).mockReset().mockImplementation(async (_s, month) => monthPayload(month));
    vi.mocked(fetchMemoirMembers).mockReset().mockResolvedValue(membersPayload());
});
afterEach(() => { vi.useRealTimers(); });

function renderPage(route: CalendarRoute = { page: 'calendar', month: '2024-09' }) {
    const go = vi.fn();
    const utils = render(<CalendarAlbumPage service="hinatazaka46" route={route} go={go} />);
    const rerender = (next: CalendarRoute) => utils.rerender(<CalendarAlbumPage service="hinatazaka46" route={next} go={go} />);
    return { go, rerender };
}

const cell = (date: string) => screen.getByTestId(`calendar-cell-${date}`);

describe('CalendarAlbumPage', () => {
    it('draws the month: Sunday-first weekday header with 日 red and 土 blue, 42 cells', async () => {
        renderPage();
        await waitFor(() => expect(within(cell('2024-09-14')).getByRole('button')).toBeInTheDocument());
        const headers = screen.getAllByTestId('calendar-weekday');
        expect(headers.map((h) => h.textContent)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
        expect(headers[0]).toHaveClass('text-calendar-holiday');
        expect(headers[6]).toHaveClass('text-calendar-saturday');
        expect(screen.getAllByTestId(/^calendar-cell-/)).toHaveLength(42);
        expect(fetchCalendarMonth).toHaveBeenCalledWith('hinatazaka46', '2024-09', undefined, expect.any(AbortSignal));
        expect(screen.getByRole('button', { name: /September 2024/ })).toBeInTheDocument();
    });

    it('only days with data are clickable', async () => {
        renderPage();
        await waitFor(() => expect(within(cell('2024-09-14')).getByRole('button')).toBeInTheDocument());
        expect(within(cell('2024-09-16')).getByRole('button')).toBeInTheDocument();
        expect(within(cell('2024-09-17')).queryByRole('button')).toBeNull();
    });

    it('‹ goes to the older month and › to the newer one, keeping the member', async () => {
        const { go } = renderPage({ page: 'calendar', month: '2024-01', memberPath: MEMBER_PATH });
        await userEvent.click(await screen.findByRole('button', { name: 'Previous month' }));
        expect(go).toHaveBeenLastCalledWith({ page: 'calendar', month: '2023-12', memberPath: MEMBER_PATH });
        await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
        expect(go).toHaveBeenLastCalledWith({ page: 'calendar', month: '2024-02', memberPath: MEMBER_PATH });
    });

    it('refetches when the route month changes', async () => {
        const { rerender } = renderPage();
        await waitFor(() => expect(fetchCalendarMonth).toHaveBeenCalledTimes(1));
        rerender({ page: 'calendar', month: '2024-08' });
        await waitFor(() => expect(fetchCalendarMonth).toHaveBeenLastCalledWith('hinatazaka46', '2024-08', undefined, expect.any(AbortSignal)));
    });

    it('without a month opens on this JST month when it has data, else the newest month with data', async () => {
        vi.mocked(fetchCalendarMonths).mockResolvedValue(monthsPayload(['2023-05', '2024-03']));
        renderPage({ page: 'calendar' });
        await waitFor(() => expect(fetchCalendarMonth).toHaveBeenCalledWith('hinatazaka46', '2024-03', undefined, expect.any(AbortSignal)));
    });

    it('the title opens the year / month picker; months without data are dimmed; a pick moves the route', async () => {
        const { go } = renderPage();
        await userEvent.click(await screen.findByRole('button', { name: /September 2024/ }));
        const months = screen.getByRole('group', { name: 'Month' });
        const aug = within(months).getByRole('button', { name: /August/ });
        const jul = within(months).getByRole('button', { name: /July/ });
        expect(aug).toHaveClass('text-primary');
        expect(jul).toHaveClass('text-muted');
        expect(jul).toHaveAccessibleName(/No messages/);
        expect(within(months).getByRole('button', { name: /September/ })).toHaveFocus();
        const years = within(screen.getByRole('group', { name: 'Year' })).getAllByRole('button').map((b) => b.textContent);
        expect(years).toEqual(['2023', '2024']);
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('calendar_picker', { phase: 'open', count: 2 });
        await userEvent.click(aug);
        expect(go).toHaveBeenCalledWith({ page: 'calendar', month: '2024-08', memberPath: undefined });
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('calendar_picker', { phase: 'select', has_target: true });
    });

    it('Escape leaves the picker for the days', async () => {
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: /September 2024/ }));
        expect(screen.getByRole('group', { name: 'Month' })).toBeInTheDocument();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('group', { name: 'Month' })).toBeNull();
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('calendar_picker', { phase: 'back', reason: 'escape' });
        expect(screen.getByRole('button', { name: /September 2024/ })).toHaveFocus();
    });

    it('the member filter offers everyone then the members (oshi first), refetches with member and logs', async () => {
        const { go, rerender } = renderPage();
        const select = await screen.findByRole('combobox', { name: 'Filter by member' });
        await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(4));
        expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Everyone', '金村 美玖', '小坂 菜緒', '潮 紗理菜']);
        await userEvent.selectOptions(select, NAO_PATH);
        expect(go).toHaveBeenCalledWith({ page: 'calendar', month: '2024-09', memberPath: NAO_PATH });
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'calendar_member', outcome: 'on' });
        rerender({ page: 'calendar', month: '2024-09', memberPath: NAO_PATH });
        await waitFor(() => expect(fetchCalendarMonth).toHaveBeenLastCalledWith('hinatazaka46', '2024-09', NAO_PATH, expect.any(AbortSignal)));
        expect(fetchCalendarMonths).toHaveBeenLastCalledWith('hinatazaka46', NAO_PATH, expect.any(AbortSignal));
    });

    it('shows the person when the route names another of her rooms', async () => {
        renderPage({ page: 'calendar', month: '2024-09', memberPath: NAO_OLD_PATH });
        const select = await screen.findByRole('combobox', { name: 'Filter by member' }) as HTMLSelectElement;
        await waitFor(() => expect(select.value).toBe(NAO_PATH));
        expect(select.selectedOptions[0].textContent).toBe('小坂 菜緒');
        // The data keeps the route's own path.
        expect(fetchCalendarMonth).toHaveBeenLastCalledWith('hinatazaka46', '2024-09', NAO_OLD_PATH, expect.any(AbortSignal));
    });

    it('names an unlisted person from her room rather than showing everyone', async () => {
        const other = '日向坂46/messages/9 河田 陽菜/9 河田 陽菜';
        renderPage({ page: 'calendar', month: '2024-09', memberPath: other });
        const select = await screen.findByRole('combobox', { name: 'Filter by member' }) as HTMLSelectElement;
        await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(5));
        expect(select.value).toBe(other);
        expect(select.selectedOptions[0].textContent).toBe('河田 陽菜');
    });

    it('keeps the previous month on screen while the next one loads', async () => {
        const { rerender } = renderPage();
        await waitFor(() => expect(within(cell('2024-09-14')).getByRole('button')).toBeInTheDocument());
        let finish: (v: ReturnType<typeof monthPayload>) => void = () => {};
        vi.mocked(fetchCalendarMonth).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        rerender({ page: 'calendar', month: '2024-08' });
        await waitFor(() => expect(fetchCalendarMonth).toHaveBeenLastCalledWith('hinatazaka46', '2024-08', undefined, expect.any(AbortSignal)));
        // No loading line in place of the grid: September stays, dimmed and busy.
        expect(screen.queryByText('Loading...')).toBeNull();
        expect(within(cell('2024-09-14')).getByRole('button')).toBeInTheDocument();
        expect(screen.getByRole('group', { name: /September 2024|August 2024/ })).toHaveAttribute('aria-busy', 'true');
        finish(monthPayload('2024-08'));
        await waitFor(() => expect(within(cell('2024-08-14')).getByRole('button')).toBeInTheDocument());
        expect(screen.getByRole('group', { name: 'August 2024' })).not.toHaveAttribute('aria-busy', 'true');
    });

    it('picking everyone again logs the filter off', async () => {
        const { go } = renderPage({ page: 'calendar', month: '2024-09', memberPath: NAO_PATH });
        const select = await screen.findByRole('combobox', { name: 'Filter by member' });
        await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(4));
        await userEvent.selectOptions(select, '');
        expect(go).toHaveBeenCalledWith({ page: 'calendar', month: '2024-09', memberPath: undefined });
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'calendar_member', outcome: 'off' });
    });

    it('a day click opens that day from the calendar', async () => {
        const { go } = renderPage();
        await userEvent.click(await within(await screen.findByTestId('calendar-cell-2024-09-14')).findByRole('button'));
        expect(go).toHaveBeenCalledWith({ page: 'day', date: '2024-09-14', from: 'calendar', memberPath: undefined });
    });

    it('a day opened under the member filter carries the member', async () => {
        const { go } = renderPage({ page: 'calendar', month: '2024-09', memberPath: NAO_PATH });
        await userEvent.click(await within(await screen.findByTestId('calendar-cell-2024-09-14')).findByRole('button'));
        expect(go).toHaveBeenCalledWith({ page: 'day', date: '2024-09-14', from: 'calendar', memberPath: NAO_PATH });
    });

    it('says so when the month has no memories, and never prints 0', async () => {
        vi.mocked(fetchCalendarMonth).mockResolvedValue(monthPayload('2024-09', []));
        renderPage();
        expect(await screen.findByText('No memories from this month yet.')).toBeInTheDocument();
        expect(screen.queryByText('0')).toBeNull();
    });
});
