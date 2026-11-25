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
    return { ...real, fetchDay: vi.fn(), fetchDayYears: vi.fn(), fetchCapsule: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { fetchCapsule, fetchDay, fetchDayYears } from '../api';
import { dayPayload, dayYearsPayload } from '../day/__fixtures__';
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
    vi.mocked(fetchDayYears).mockReset().mockResolvedValue(dayYearsPayload());
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

describe('OnThisDayDetail 歴年の同じ日', () => {
    it('has no side-by-side toggle any more: the day view offers 歴年の同じ日 instead', async () => {
        renderDetail(TWO_YEARS, 2022);
        expect(await screen.findByTestId('day-view')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'ほかの年とならべる' })).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: '歴年の同じ日' }));
        expect(vi.mocked(fetchDayYears)).toHaveBeenCalledWith('hinatazaka46', { monthDay: '09-14', member: undefined }, expect.anything());
        expect(await screen.findAllByTestId('day-years-lane')).toHaveLength(2);
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'day_years', outcome: 'on' });
    });

    it('keeps the day view of the picked year', async () => {
        const { rerender } = renderDetail([year(2021, true), ...TWO_YEARS], 2022);
        await screen.findByTestId('day-view');
        rerender(2021);
        await waitFor(() => expect(vi.mocked(fetchDay).mock.lastCall?.[1]).toEqual(expect.objectContaining({ date: '2021-09-14' })));
    });
});
