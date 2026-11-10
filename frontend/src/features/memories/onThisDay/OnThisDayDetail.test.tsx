import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import i18n from '../../../i18n';
import { server } from '../../../__tests__/mocks/server';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchDay: vi.fn(), fetchCapsule: vi.fn(), fetchThenNowDay: vi.fn(), fetchThenNowFirstWeek: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { fetchCapsule, fetchDay, fetchThenNowDay, fetchThenNowFirstWeek } from '../api';
import { dayPayload } from '../day/__fixtures__';
import { thenNowDay } from '../thenNow/__fixtures__';
import type { OnThisDayPayload } from '../types';
import { OnThisDayDetail } from './OnThisDayDetail';

beforeAll(async () => { await i18n.changeLanguage('ja'); });
beforeEach(() => {
    server.use(
        http.get('/api/app-state/translations', () => HttpResponse.json({})),
        http.patch('/api/app-state/translations', () => HttpResponse.json({})),
        http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })),
    );
    vi.mocked(clientLog).mockClear();
    vi.mocked(fetchDay).mockReset().mockResolvedValue(dayPayload());
    vi.mocked(fetchCapsule).mockReset().mockResolvedValue({ notes: [] });
    vi.mocked(fetchThenNowDay).mockReset().mockResolvedValue(thenNowDay());
    vi.mocked(fetchThenNowFirstWeek).mockReset().mockResolvedValue(null);
});

const year = (y: number, has: boolean): OnThisDayPayload['years'][number] => (has
    ? { year: y, has_messages: true, message_count: 3, member_count: 1, preview: [], more: null, thumb: null }
    : { year: y, has_messages: false });

const TWO_YEARS = [year(2022, true), year(2023, false), year(2024, true)];

function renderDetail(years: OnThisDayPayload['years'], selected: number) {
    const onSelectYear = vi.fn();
    const ui = (y: number) => (
        <OnThisDayDetail service="hinatazaka46" monthDay="09-14" year={y} years={years} onSelectYear={onSelectYear} />
    );
    const utils = render(ui(selected));
    return { onSelectYear, rerender: (y: number) => utils.rerender(ui(y)) };
}

const TOGGLE = '今年とならべる';

describe('OnThisDayDetail あの日と今日', () => {
    it('offers the ⇆ toggle in the day header when another year with messages exists', async () => {
        renderDetail(TWO_YEARS, 2022);
        expect(await screen.findByRole('button', { name: TOGGLE })).toBeInTheDocument();
        expect(screen.getByTestId('day-view')).toBeInTheDocument();
    });

    it('has no toggle with a single year of messages', async () => {
        renderDetail([year(2022, false), year(2024, true)], 2024);
        expect(await screen.findByTestId('day-view')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: TOGGLE })).toBeNull();
    });

    it('swaps the day view for the panel on that date, logs it, and switches back', async () => {
        renderDetail(TWO_YEARS, 2022);
        await userEvent.click(await screen.findByRole('button', { name: TOGGLE }));
        expect(screen.queryByTestId('day-view')).toBeNull();
        expect(await screen.findAllByTestId('then-now-side')).toHaveLength(2);
        expect(vi.mocked(fetchThenNowDay).mock.calls[0]?.[1]).toEqual({ date: '2022-09-14', member: undefined });
        expect(vi.mocked(fetchThenNowFirstWeek)).not.toHaveBeenCalled();
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'then_now', outcome: 'on' });
        await userEvent.click(screen.getByRole('button', { name: 'もとの表示へ' }));
        expect(await screen.findByTestId('day-view')).toBeInTheDocument();
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'then_now', outcome: 'off' });
    });

    it('a year change resets the toggle', async () => {
        const { rerender } = renderDetail([year(2021, true), ...TWO_YEARS], 2022);
        await userEvent.click(await screen.findByRole('button', { name: TOGGLE }));
        await screen.findAllByTestId('then-now-side');
        rerender(2021);
        expect(await screen.findByTestId('day-view')).toBeInTheDocument();
        await waitFor(() => expect(vi.mocked(fetchDay).mock.lastCall?.[1]).toEqual(expect.objectContaining({ date: '2021-09-14' })));
    });
});
