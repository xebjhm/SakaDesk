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
// MessageBubble asks for cached translations and transcripts of what it shows (and saves a translation).
beforeEach(() => {
    server.use(
        http.get('/api/app-state/translations', () => HttpResponse.json({})),
        http.patch('/api/app-state/translations', () => HttpResponse.json({})),
        http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })),
    );
});

const PAYLOAD: OnThisDayPayload = {
    month_day: '09-14',
    years: [
        { year: 2021, has_messages: false },
        {
            year: 2022, has_messages: true, message_count: 7, member_count: 2,
            preview: [{ ...memoryMessage({ id: 21, ts: '2022-09-14T12:00:00Z', text: '初めての握手会', room: 'messages/12 金村美玖（ひらがな）/3 金村美玖' }), name: '金村 美玖' }], more: 6,
            thumb: memoryMessage({ id: 22, type: 'video', text: null, media_url: '/api/content/media/hinatazaka46/v.mp4' }),
        },
        { year: 2023, has_messages: false },
        {
            year: 2024, has_messages: true, message_count: 1, member_count: 1,
            preview: [{ ...memoryMessage({ id: 41, ts: '2024-09-14T03:41:00Z', text: 'お昼はラーメン🍜' }), name: '金村 美玖' }], more: null,
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
        // Her display name from the payload, never the older room's suffixed folder name.
        expect(within(columns[0]).getByText('金村 美玖')).toHaveAttribute('lang', 'ja');
        expect(columns[0].textContent).not.toContain('ひらがな');
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
        // The picker opens on the viewed month (September).
        expect(go).toHaveBeenLastCalledWith({ page: 'onThisDay', monthDay: '09-03' });
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

describe('OnThisDayPage overview, details', () => {
    it('shows preview times on the JST clock', async () => {
        renderPage({ page: 'onThisDay', monthDay: '09-14' });
        const columns = await screen.findAllByTestId('otd-column');
        expect(columns[0]).toHaveTextContent('21:00'); // 12:00Z
        expect(columns[1]).toHaveTextContent('12:41'); // 03:41Z
    });

    it('never puts a video thumb into an image', async () => {
        renderPage({ page: 'onThisDay', monthDay: '09-14' });
        const columns = await screen.findAllByTestId('otd-column');
        expect(columns[0].querySelector('img')).toBeNull();
        expect(within(columns[0]).getByTestId('memory-thumb-video')).toHaveAttribute('src', '/api/content/media/hinatazaka46/v.mp4');
        expect(columns[1].querySelector('img')).toHaveAttribute('src', '/api/content/media/hinatazaka46/p.jpg');
    });

    it('starts at the newest year and keeps the user’s scroll across re-renders', async () => {
        const width = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900);
        try {
            const { rerender } = renderPage({ page: 'onThisDay', monthDay: '09-14' });
            const strip = await screen.findByTestId('otd-strip');
            expect(strip.scrollLeft).toBe(900);
            strip.scrollLeft = 120;
            // Opening and closing the picker re-renders the page.
            await userEvent.click(screen.getByRole('button', { name: /Choose a date/ }));
            await userEvent.keyboard('{Escape}');
            rerender(<OnThisDayPage service="hinatazaka46" route={{ page: 'onThisDay', monthDay: '09-14' }} go={go} />);
            expect(screen.getByTestId('otd-strip').scrollLeft).toBe(120);
        } finally {
            width.mockRestore();
        }
    });

    it('opens the date picker on the month being viewed', async () => {
        renderPage({ page: 'onThisDay', monthDay: '02-14' });
        await screen.findAllByTestId('otd-column');
        await userEvent.click(screen.getByRole('button', { name: /Choose a date/ }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('button', { name: /February/ })).toBeInTheDocument();
    });
});

describe('OnThisDayPage detail', () => {
    it('puts focus on the selected year so ← / → work at once', async () => {
        renderPage({ page: 'onThisDay', monthDay: '09-14', year: 2024 });
        const rows = await screen.findAllByTestId('otd-year-row');
        expect(document.activeElement).toBe(rows[0]);
        await userEvent.keyboard('{ArrowLeft}');
        expect(go).toHaveBeenLastCalledWith({ page: 'onThisDay', monthDay: '09-14', year: 2022 });
    });

    it('shows a video thumb in the year list as a video still', async () => {
        renderPage({ page: 'onThisDay', monthDay: '09-14', year: 2024 });
        const rows = await screen.findAllByTestId('otd-year-row');
        expect(rows[2].querySelector('img')).toBeNull();
        expect(within(rows[2]).getByTestId('memory-thumb-video')).toBeInTheDocument();
    });

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
