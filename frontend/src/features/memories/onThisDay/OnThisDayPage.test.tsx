import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import i18n from '../../../i18n';
import { server } from '../../../__tests__/mocks/server';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchOnThisDay: vi.fn(), fetchDay: vi.fn() };
});
import { fetchDay, fetchOnThisDay } from '../api';
import { OnThisDayPage, type OnThisDayRoute } from './OnThisDayPage';
import type { MemoriesRoute } from '../MemoriesFeature';
import type { OnThisDayPayload } from '../types';
import { memoryMessage } from '../__fixtures__/memories';
import { dayPayload } from '../day/__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('en'); });
// MessageBubble asks for cached translations of what it shows.
beforeEach(() => { server.use(http.get('/api/app-state/translations', () => HttpResponse.json({}))); });

const PAYLOAD: OnThisDayPayload = {
    month_day: '09-14',
    years: [
        { year: 2021, has_messages: false },
        {
            year: 2022, has_messages: true, message_count: 7, member_count: 2,
            preview: [memoryMessage({ id: 21, ts: '2022-09-14T12:00:00Z', text: '初めての握手会' })], more: 6, thumb: null,
        },
        { year: 2023, has_messages: false },
        {
            year: 2024, has_messages: true, message_count: 1, member_count: 1,
            preview: [memoryMessage({ id: 41, ts: '2024-09-14T03:41:00Z', text: 'お昼はラーメン🍜' })], more: null,
            thumb: memoryMessage({ id: 42, type: 'picture', text: null, media_url: '/api/content/media/hinatazaka46/p.jpg' }),
        },
    ],
};

let go: ReturnType<typeof vi.fn<(next: MemoriesRoute) => void>>;
beforeEach(() => {
    go = vi.fn<(next: MemoriesRoute) => void>();
    vi.mocked(fetchOnThisDay).mockReset().mockResolvedValue(PAYLOAD);
    vi.mocked(fetchDay).mockReset().mockResolvedValue(dayPayload());
});

const renderPage = (route: OnThisDayRoute) => render(<OnThisDayPage service="hinatazaka46" route={route} go={go} />);

describe('OnThisDayPage overview', () => {
    it('shows one column per year with messages, never the empty years', async () => {
        renderPage({ page: 'onThisDay', monthDay: '09-14' });
        const columns = await screen.findAllByTestId('otd-column');
        expect(columns.map((c) => within(c).getByTestId('otd-year').textContent)).toEqual(['2022', '2024']);
        expect(within(columns[0]).getByText('初めての握手会')).toHaveAttribute('lang', 'ja');
        expect(within(columns[0]).getByText('+6 more')).toBeInTheDocument();
        expect(within(columns[1]).queryByText(/more/)).toBeNull();
        expect(vi.mocked(fetchOnThisDay)).toHaveBeenCalledWith('hinatazaka46', '09-14', expect.anything());
        expect(screen.getByTestId('memories-page-onThisDay')).toHaveAttribute('data-service', 'hinatazaka46');
    });

    it('steps to the previous and next day', async () => {
        renderPage({ page: 'onThisDay', monthDay: '03-01' });
        await screen.findAllByTestId('otd-column');
        await userEvent.click(screen.getByRole('button', { name: 'Previous day' }));
        expect(go).toHaveBeenLastCalledWith({ page: 'onThisDay', monthDay: '02-29' });
        await userEvent.click(screen.getByRole('button', { name: 'Next day' }));
        expect(go).toHaveBeenLastCalledWith({ page: 'onThisDay', monthDay: '03-02' });
    });

    it('wraps around the year end', async () => {
        renderPage({ page: 'onThisDay', monthDay: '12-31' });
        await screen.findAllByTestId('otd-column');
        await userEvent.click(screen.getByRole('button', { name: 'Next day' }));
        expect(go).toHaveBeenLastCalledWith({ page: 'onThisDay', monthDay: '01-01' });
    });

    it('sets the month-day from any date picked in the calendar', async () => {
        renderPage({ page: 'onThisDay', monthDay: '09-14' });
        await screen.findAllByTestId('otd-column');
        await userEvent.click(screen.getByRole('button', { name: /Choose a date/ }));
        const dialog = await screen.findByRole('dialog');
        const day = dialog.querySelector<HTMLButtonElement>('button[data-day="3"]:not([data-outside])')!;
        expect(day).not.toBeDisabled();
        await userEvent.click(day);
        const month = String(new Date().getMonth() + 1).padStart(2, '0');
        expect(go).toHaveBeenLastCalledWith({ page: 'onThisDay', monthDay: `${month}-03` });
    });

    it('opens the detail of a year from its column', async () => {
        renderPage({ page: 'onThisDay', monthDay: '09-14' });
        const columns = await screen.findAllByTestId('otd-column');
        await userEvent.click(columns[1]);
        expect(go).toHaveBeenLastCalledWith({ page: 'onThisDay', monthDay: '09-14', year: 2024 });
    });

    it('shows the gentle empty state with the date picker when no year has messages', async () => {
        vi.mocked(fetchOnThisDay).mockResolvedValue({ month_day: '09-14', years: [{ year: 2023, has_messages: false }] });
        renderPage({ page: 'onThisDay', monthDay: '09-14' });
        expect(await screen.findByText(i18n.t('memories.onThisDay.empty'))).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /Choose a date/ }).length).toBeGreaterThan(0);
        expect(screen.queryByTestId('otd-column')).toBeNull();
        expect(document.body.textContent).not.toMatch(/\b0\b/);
    });
});

describe('OnThisDayPage detail', () => {
    it('lists the years, dims the empty ones and makes them unclickable', async () => {
        renderPage({ page: 'onThisDay', monthDay: '09-14', year: 2024 });
        const rows = await screen.findAllByTestId('otd-year-row');
        expect(rows.map((r) => r.getAttribute('data-year'))).toEqual(['2024', '2023', '2022', '2021']);
        const empty = rows[1];
        expect(empty.tagName).not.toBe('BUTTON');
        expect(empty).toHaveTextContent('No messages on this day');
        expect(empty).toHaveAttribute('aria-disabled', 'true');
        await userEvent.click(empty);
        expect(go).not.toHaveBeenCalled();
        expect(rows[0]).toHaveAttribute('aria-current', 'true');
        expect(rows[2]).toHaveTextContent('7 messages');
        await userEvent.click(rows[2]);
        expect(go).toHaveBeenLastCalledWith({ page: 'onThisDay', monthDay: '09-14', year: 2022 });
    });

    it('shows that year’s day view', async () => {
        renderPage({ page: 'onThisDay', monthDay: '09-14', year: 2024 });
        await screen.findByTestId('day-merged');
        expect(vi.mocked(fetchDay)).toHaveBeenCalledWith('hinatazaka46', expect.objectContaining({ date: '2024-09-14' }), expect.anything());
    });

    it('steps between years with messages with ← / → (older / newer)', async () => {
        renderPage({ page: 'onThisDay', monthDay: '09-14', year: 2024 });
        const page = await screen.findByTestId('memories-page-onThisDay');
        await screen.findAllByTestId('otd-year-row');
        fireEvent.keyDown(page, { key: 'ArrowRight' });
        expect(go).not.toHaveBeenCalled();
        fireEvent.keyDown(page, { key: 'ArrowLeft' });
        expect(go).toHaveBeenLastCalledWith({ page: 'onThisDay', monthDay: '09-14', year: 2022 });
        await userEvent.click(screen.getByRole('button', { name: 'Older year' }));
        expect(go).toHaveBeenLastCalledWith({ page: 'onThisDay', monthDay: '09-14', year: 2022 });
    });

    it('goes back to the overview of the same date', async () => {
        renderPage({ page: 'onThisDay', monthDay: '09-14', year: 2024 });
        await screen.findAllByTestId('otd-year-row');
        await userEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(go).toHaveBeenLastCalledWith({ page: 'onThisDay', monthDay: '09-14' });
    });
});
