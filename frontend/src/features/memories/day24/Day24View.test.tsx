import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchDay24: vi.fn(), fetchDay: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { fetchDay, fetchDay24 } from '../api';
import { dayMessage, dayPayload, MIKU } from '../day/__fixtures__';
import { MEMBER_PATH, memoryMessage } from '../__fixtures__/memories';
import type { Day24Full } from '../types';
import { Day24View, RECENT_MAX } from './Day24View';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

// JST clocks: 22:30Z = 07:30 JST next day; 03:30Z = 12:30; 09:30Z = 18:30; 13:30Z = 22:30.
function day(over: Partial<Day24Full> = {}): Day24Full {
    return {
        seed: 20001,
        years: 3,
        slots: [
            { code: 'ohayo', message: memoryMessage({ id: 1, ts: '2022-05-01T22:30:00Z', text: 'おはよう☀️' }) },
            { code: 'ohiru', message: memoryMessage({ id: 2, ts: '2024-08-10T03:30:00Z', type: 'picture', text: null, media_url: '/api/content/media/hinatazaka46/lunch.jpg' }) },
            { code: 'hour', message: memoryMessage({ id: 3, ts: '2023-01-02T06:10:00Z', text: 'レッスン中💃' }) },
            { code: 'otsukare', message: memoryMessage({ id: 4, ts: '2024-02-03T09:30:00Z', text: 'おつかれさま' }) },
            { code: 'oyasumi', message: memoryMessage({ id: 5, ts: '2022-11-20T13:30:00Z', text: '%%%、おやすみ🌙' }) },
        ],
        ...over,
    };
}

beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    vi.mocked(fetchDay24).mockReset().mockResolvedValue(day());
});

const renderView = () => render(<Day24View service="hinatazaka46" memberPath={MEMBER_PATH} name="金村 美玖" />);

describe('Day24View', () => {
    it('titles her day and draws the slots in order with their JST time and year', async () => {
        renderView();
        const slots = await screen.findAllByTestId('day24-slot');
        expect(screen.getByRole('heading', { name: '金村 美玖の一日' })).toHaveClass('font-display');
        expect(screen.getByText('3年分のメッセージから')).toBeInTheDocument();
        expect(slots.map((s) => within(s).getByTestId('day24-time').textContent)).toEqual(['07:30', '12:30', '15:10', '18:30', '22:30']);
        expect(slots.map((s) => within(s).getByTestId('day24-year').textContent)).toEqual(['2022年', '2024年', '2023年', '2024年', '2022年']);
        expect(within(slots[4]).getByTestId('memory-text')).toHaveAttribute('lang', 'ja');
        expect(within(slots[1]).getByTestId('memory-thumb')).toBeInTheDocument();
        expect(screen.getByTestId('day24-sky')).toHaveClass('bg-memories-sky');
        expect(vi.mocked(fetchDay24).mock.calls[0]?.slice(0, 3)).toEqual(['hinatazaka46', MEMBER_PATH, undefined]);
    });

    it('says "from one year" when the day came from a single year', async () => {
        vi.mocked(fetchDay24).mockResolvedValue(day({ years: 1 }));
        renderView();
        expect(await screen.findByText('ある年のメッセージから')).toBeInTheDocument();
        expect(screen.queryByText(/年分/)).toBeNull();
    });

    it('🎲 builds another day with a different seed and logs the load', async () => {
        renderView();
        await screen.findAllByTestId('day24-slot');
        vi.mocked(clientLog).mockClear();
        await userEvent.click(screen.getByRole('button', { name: 'ほかの一日をつくる' }));
        await waitFor(() => expect(vi.mocked(fetchDay24)).toHaveBeenCalledTimes(2));
        const seed = vi.mocked(fetchDay24).mock.calls[1]?.[2];
        expect(typeof seed).toBe('number');
        expect(seed).not.toBe(20001);
        // the day on screen is remembered, so the backend avoids it
        expect(vi.mocked(fetchDay24).mock.calls[0]?.[4]).toEqual([]);
        expect(vi.mocked(fetchDay24).mock.calls[1]?.[4]).toEqual([1, 2, 3, 4, 5]);
        await waitFor(() => expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_load', expect.objectContaining({ target: 'day24', outcome: 'ok' })));
    });

    it('a thin day shows the gentle card, no number, and logs day24_thin', async () => {
        vi.mocked(fetchDay24).mockResolvedValue({ slots: [] });
        renderView();
        expect(await screen.findByText('もう少しメッセージが届いたら、ここに一日ができます。')).toBeInTheDocument();
        expect(screen.queryByTestId('day24-slot')).toBeNull();
        expect(screen.queryByText(/年分|ある年/)).toBeNull();
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_skip', { target: 'day24', reason: 'day24_thin' });
    });

    it('a slot opens a dialog with only her messages of that JST day, the slot message focused', async () => {
        vi.mocked(fetchDay).mockResolvedValue(dayPayload({
            date: '2022-05-02',
            members: [MIKU],
            messages: [
                dayMessage(MIKU, { id: 1, ts: '2022-05-01T22:30:00Z', text: 'おはよう☀️' }),
                dayMessage(MIKU, { id: 7, ts: '2022-05-02T03:00:00Z', text: 'お昼だよ' }),
            ],
        }));
        renderView();
        const slots = await screen.findAllByTestId('day24-slot');
        await userEvent.click(within(slots[0]).getByRole('button', { name: /おはよう/ }));
        const dialog = await screen.findByRole('dialog');
        // 22:30Z on 2022-05-01 is 07:30 JST on 2022-05-02; only her messages (member=)
        expect(vi.mocked(fetchDay).mock.calls[0]?.[1]).toEqual({ date: '2022-05-02', member: MEMBER_PATH });
        const rows = await within(dialog).findAllByTestId('day-merged-row');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveAttribute('data-focused', 'true');
        expect(rows[1]).not.toHaveAttribute('data-focused');
        expect(within(dialog).getByTestId('day24-day-label')).toHaveTextContent('2022');
        // the dialog scrolls only the day column (its own scroller), never its body
        expect(within(dialog).getByTestId('day24-day-scroller')).toHaveAttribute('data-focus-scroller');
        expect(within(dialog).getByTestId('modal-body')).toHaveClass('md:overflow-hidden');
    });

    it('closing the dialog returns to the same 24h day, with no refetch', async () => {
        vi.mocked(fetchDay).mockResolvedValue(dayPayload({ members: [MIKU], messages: [] }));
        renderView();
        const slots = await screen.findAllByTestId('day24-slot');
        await userEvent.click(within(slots[2]).getByRole('button'));
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(screen.getAllByTestId('day24-slot')).toHaveLength(5);
        expect(vi.mocked(fetchDay24)).toHaveBeenCalledTimes(1);
    });

    it('the dialog shows the loading contract while her day loads, then a retry on failure', async () => {
        vi.mocked(fetchDay).mockRejectedValueOnce(new Error('boom'));
        renderView();
        const slots = await screen.findAllByTestId('day24-slot');
        await userEvent.click(within(slots[3]).getByRole('button'));
        const dialog = await screen.findByRole('dialog');
        expect(await within(dialog).findByRole('button', { name: 'もう一度' })).toBeInTheDocument();
    });

    it('🎲 keeps the view and the focus while the next day loads', async () => {
        renderView();
        await screen.findAllByTestId('day24-slot');
        let resolve: (d: Day24Full) => void = () => {};
        vi.mocked(fetchDay24).mockImplementation(() => new Promise((r) => { resolve = r; }));
        const dice = screen.getByRole('button', { name: 'ほかの一日をつくる' });
        await userEvent.click(dice);
        expect(dice).toBeInTheDocument();
        expect(dice).toHaveFocus();
        expect(screen.getByRole('heading', { name: '金村 美玖の一日' })).toBeInTheDocument();
        expect(screen.getByTestId('day24-slots')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getAllByTestId('day24-slot')).toHaveLength(5);
        resolve(day({ seed: 7, years: 2 }));
        expect(await screen.findByText('2年分のメッセージから')).toBeInTheDocument();
        expect(screen.getByTestId('day24-slots')).not.toHaveAttribute('aria-busy');
        expect(screen.getByRole('button', { name: 'ほかの一日をつくる' })).toHaveFocus();
    });

    it('a failed reroll keeps the header and offers a retry inside the day', async () => {
        renderView();
        await screen.findAllByTestId('day24-slot');
        vi.mocked(fetchDay24).mockRejectedValueOnce(new Error('boom'));
        await userEvent.click(screen.getByRole('button', { name: 'ほかの一日をつくる' }));
        const retry = await screen.findByRole('button', { name: 'もう一度' });
        expect(screen.getByRole('heading', { name: '金村 美玖の一日' })).toBeInTheDocument();
        expect(screen.queryByTestId('day24-slot')).toBeNull();
        await userEvent.click(retry);
        expect(await screen.findAllByTestId('day24-slot')).toHaveLength(5);
    });

    it('remembers at most RECENT_MAX shown ids across re-rolls', async () => {
        renderView();
        await screen.findAllByTestId('day24-slot');
        for (let n = 2; n <= 6; n += 1) {
            await userEvent.click(screen.getByRole('button', { name: 'ほかの一日をつくる' }));
            await waitFor(() => expect(vi.mocked(fetchDay24)).toHaveBeenCalledTimes(n));
            await waitFor(() => expect(screen.getByTestId('day24-slots')).not.toHaveAttribute('aria-busy'));
        }
        const last = vi.mocked(fetchDay24).mock.calls[5]?.[4] ?? [];
        expect(last).toHaveLength(RECENT_MAX);
    });
});
