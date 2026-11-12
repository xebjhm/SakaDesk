import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { installMediaTileHarness } from '../../../__tests__/mediaTileHarness';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import i18n from '../../../i18n';
import { server } from '../../../__tests__/mocks/server';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchOnThisDay: vi.fn(), fetchDay: vi.fn(), fetchCapsule: vi.fn(), fetchCapsuleDue: vi.fn() };
});
import { fetchCapsule, fetchCapsuleDue, fetchDay, fetchOnThisDay } from '../api';
import { resurfaceItem } from '../capsule/__fixtures__';
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
    vi.mocked(fetchCapsule).mockReset().mockResolvedValue({ notes: [] });
    vi.mocked(fetchCapsuleDue).mockReset().mockResolvedValue({ notes: [] });
});

const renderPage = (route: OnThisDayRoute) => render(<OnThisDayPage service="hinatazaka46" route={route} go={go} />);

afterEach(() => { vi.unstubAllGlobals(); });

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
        const h = installMediaTileHarness();
        renderPage({ page: 'onThisDay', monthDay: '09-14' });
        const columns = await screen.findAllByTestId('otd-column');
        expect(columns[0].querySelector('img')).toBeNull();
        expect(columns[0].querySelector('video')).toBeNull();
        expect(within(columns[0]).getByTestId('memory-thumb')).toBeInTheDocument();
        // a picture column asks for a thumbnail (the media viewer keeps the full file)
        await waitFor(() => expect(h.requested()).toContain('/api/content/thumb/hinatazaka46/p.jpg?w=160'));
        expect(h.requested()).not.toContain('/api/content/media/hinatazaka46/v.mp4');
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
        expect(rows[2].querySelector('video')).toBeNull();
        expect(within(rows[2]).getByTestId('memory-thumb')).toBeInTheDocument();
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

describe('OnThisDayPage capsule', () => {
    it('shows the notes resurfacing on this month-day above the year strip', async () => {
        vi.mocked(fetchCapsuleDue).mockResolvedValue({ notes: [resurfaceItem({ years_ago: 2 })] });
        renderPage({ page: 'onThisDay', monthDay: '09-14' });
        const due = await screen.findByTestId('otd-capsule-due');
        expect(within(due).getByText('A note you wrote 2 years ago')).toBeInTheDocument();
        const strip = screen.getAllByTestId('otd-column')[0];
        expect(due.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(fetchCapsuleDue).toHaveBeenCalledWith('hinatazaka46', '09-14', expect.any(AbortSignal));
    });

    it('hides when no note is due', async () => {
        renderPage({ page: 'onThisDay', monthDay: '09-14' });
        await screen.findAllByTestId('otd-column');
        expect(screen.queryByTestId('otd-capsule-due')).toBeNull();
    });

    it('does not ask for due notes in the detail', async () => {
        renderPage({ page: 'onThisDay', monthDay: '09-14', year: 2024 });
        await screen.findByTestId('day-view');
        expect(fetchCapsuleDue).not.toHaveBeenCalled();
    });
});

describe('OnThisDayPage keeps the previous step (F24)', () => {
    it('a month-day step keeps the previous years visible and aria-busy, and swaps when ready', async () => {
        const { rerender } = renderPage({ page: 'onThisDay', monthDay: '09-14' });
        await screen.findAllByTestId('otd-column');
        let finish: (v: OnThisDayPayload) => void = () => {};
        vi.mocked(fetchOnThisDay).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        rerender(<OnThisDayPage service="hinatazaka46" route={{ page: 'onThisDay', monthDay: '09-15' }} go={go} />);
        await waitFor(() => expect(fetchOnThisDay).toHaveBeenLastCalledWith('hinatazaka46', '09-15', expect.anything()));
        const kept = screen.getByText('初めての握手会');
        expect(kept.closest('[aria-busy="true"]')).not.toBeNull();
        // The kept day is inert: its year columns cannot open a year of the new date.
        expect(kept.closest('[inert]')).not.toBeNull();
        expect(screen.queryByRole('status')).toBeNull();
        finish({ month_day: '09-15', years: [{ year: 2023, has_messages: true, message_count: 1, member_count: 1, preview: [{ ...memoryMessage({ id: 51, text: '新しい日 🌸' }), name: '金村 美玖' }], more: null, thumb: null }] });
        expect(await screen.findByText('新しい日 🌸')).toBeInTheDocument();
        expect(screen.queryByText('初めての握手会')).toBeNull();
        expect(screen.getByText('新しい日 🌸').closest('[aria-busy="true"]')).toBeNull();
    });
});

describe('OnThisDayPage never keeps an empty day', () => {
    it('a step away from an empty day shows the loading state, not the empty copy under the new date', async () => {
        vi.mocked(fetchOnThisDay).mockResolvedValueOnce({ month_day: '06-04', years: [{ year: 2022, has_messages: false }] });
        const { rerender } = renderPage({ page: 'onThisDay', monthDay: '06-04' });
        expect(await screen.findByText('No memories from this day here yet. Try opening another day.')).toBeInTheDocument();
        vi.mocked(fetchOnThisDay).mockImplementationOnce(() => new Promise(() => {}));
        rerender(<OnThisDayPage service="hinatazaka46" route={{ page: 'onThisDay', monthDay: '06-05' }} go={go} />);
        expect(screen.queryByText('No memories from this day here yet. Try opening another day.')).toBeNull();
        await waitFor(() => expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument());
    });
});
