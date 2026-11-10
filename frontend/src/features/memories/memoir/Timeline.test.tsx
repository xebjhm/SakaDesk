import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchTimelineMonths: vi.fn(), fetchTimelineMonth: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { openChat } from '../../../shell/openChat';
import { fetchTimelineMonth, fetchTimelineMonths } from '../api';
import { MEMBER_PATH, memoryMessage } from '../__fixtures__/memories';
import { NicknameProvider } from '../shared/useNickname';
import type { TimelineMonthPayload, TimelineMonthsPayload } from '../types';
import { Timeline } from './Timeline';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const MONTHS: TimelineMonthsPayload = {
    months: [
        { month: '2024-10', count: 12 },
        { month: '2024-11', count: 0 },
        { month: '2024-12', count: 37 },
    ],
};

function monthPayload(month: string, over: Partial<TimelineMonthPayload> = {}): TimelineMonthPayload {
    return {
        month,
        count: 37,
        avatar_url: '/api/content/media/avatar-dec.jpg',
        photos: [1, 2, 3].map((n) => memoryMessage({
            id: 100 + n, type: 'picture', text: null, ts: `2024-12-0${n}T03:00:00Z`,
            media_url: `/api/content/media/p${n}.jpg`, media_file: `messages/x/picture/${n}.jpg`,
        })),
        messages: {
            top: memoryMessage({ id: 7, text: 'ずっと%%%に伝えたかったこと' }),
            late: memoryMessage({ id: 8, ts: '2024-12-05T15:30:00Z', text: 'おやすみ🌙' }),
            nickname: null,
        },
        milestones: [
            { key: 'anniv.y1', date: '2024-12-10', foil: false },
            { key: 'first.nickname', date: '2024-12-20', foil: true },
        ],
        ...over,
    };
}

beforeEach(() => {
    server.use(http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })));
    vi.mocked(clientLog).mockClear();
    vi.mocked(openChat).mockClear();
    vi.mocked(fetchTimelineMonths).mockReset().mockResolvedValue(MONTHS);
    vi.mocked(fetchTimelineMonth).mockReset().mockImplementation(async (_s, _m, month) => monthPayload(month));
});

function renderTimeline() {
    return render(
        <NicknameProvider nickname="みーぱん">
            <Timeline service="hinatazaka46" memberPath={MEMBER_PATH} name="金村 美玖" />
        </NicknameProvider>,
    );
}

describe('Timeline', () => {
    it('starts at the newest month with her avatar then, the serif month label and one number', async () => {
        renderTimeline();
        await waitFor(() => expect(vi.mocked(fetchTimelineMonth).mock.calls[0]?.slice(0, 3)).toEqual(['hinatazaka46', MEMBER_PATH, '2024-12']));
        const heading = await screen.findByRole('heading', { name: '2024年12月' });
        expect(heading).toHaveClass('font-display');
        expect(await screen.findByText('37 件')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: '金村 美玖' })).toHaveAttribute('src', '/api/content/media/avatar-dec.jpg');
        expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '2024年12月');
    });

    it('shows the labelled word slots and leaves out an empty one', async () => {
        renderTimeline();
        const top = await screen.findByTestId('timeline-slot-top');
        expect(top).toHaveTextContent('いちばん想いのこもった一通');
        expect(top).toHaveTextContent('ずっとみーぱんに伝えたかったこと');
        expect(screen.getByTestId('timeline-slot-late')).toHaveTextContent('夜ふけの一通');
        expect(screen.queryByTestId('timeline-slot-nickname')).not.toBeInTheDocument();
        expect(screen.queryByText('名前を呼んでくれた一通')).not.toBeInTheDocument();
        await userEvent.click(within(top).getByRole('button', { name: 'トークで見る' }));
        expect(vi.mocked(openChat)).toHaveBeenCalledWith(expect.objectContaining({ path: MEMBER_PATH, message_id: 7 }));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_jump', { target: 'timeline', has_target: true });
    });

    it('lists the month milestones, a foil one with the foil sheen', async () => {
        renderTimeline();
        const list = await screen.findByRole('list', { name: 'この月のできごと' });
        const chips = within(list).getAllByRole('listitem');
        expect(chips).toHaveLength(2);
        expect(chips[0]).toHaveTextContent('1年目の記念日');
        expect(chips[0]).not.toHaveClass('bg-memories-foil');
        expect(chips[1]).toHaveClass('bg-memories-foil');
    });

    it('opens the media viewer at a clicked photo, with the jump to her chat', async () => {
        renderTimeline();
        const strip = await screen.findByTestId('timeline-photos');
        const photos = within(strip).getAllByRole('button');
        expect(photos).toHaveLength(3);
        await userEvent.click(photos[1]);
        const viewer = await screen.findByRole('dialog');
        expect(within(viewer).getByText('2 / 3')).toBeInTheDocument();
        await userEvent.click(within(viewer).getByText('トークで見る'));
        expect(vi.mocked(openChat)).toHaveBeenCalledWith(expect.objectContaining({ message_id: 102 }));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_jump', { target: 'timeline', has_target: true });
    });

    it('fetches the month picked on the rail and drops a month left quickly', async () => {
        renderTimeline();
        await screen.findByRole('heading', { name: '2024年12月' });
        await screen.findByText('37 件');
        vi.mocked(fetchTimelineMonth).mockImplementation((_s, _m, month) => (
            month === '2024-11' ? new Promise(() => {}) : Promise.resolve(monthPayload(month, { count: 12, messages: { top: null, late: null, nickname: null } }))
        ));
        const rail = screen.getByRole('slider');
        fireEvent.keyDown(rail, { key: 'ArrowLeft' });
        expect(await screen.findByRole('heading', { name: '2024年11月' })).toBeInTheDocument();
        await waitFor(() => expect(vi.mocked(fetchTimelineMonth).mock.lastCall?.[2]).toBe('2024-11'));
        const pending = vi.mocked(fetchTimelineMonth).mock.lastCall?.[3] as AbortSignal;
        fireEvent.keyDown(rail, { key: 'ArrowLeft' });
        await waitFor(() => expect(vi.mocked(fetchTimelineMonth).mock.lastCall?.[2]).toBe('2024-10'));
        expect(pending.aborted).toBe(true);
        expect(await screen.findByText('12 件')).toBeInTheDocument();
        expect(screen.queryByTestId('timeline-slot-top')).not.toBeInTheDocument();
    });

    it('never shows a 0 for an empty month', async () => {
        vi.mocked(fetchTimelineMonth).mockImplementation(async (_s, _m, month) => monthPayload(month, {
            count: 0, photos: [], messages: { top: null, late: null, nickname: null }, milestones: [],
        }));
        renderTimeline();
        await screen.findByRole('heading', { name: '2024年12月' });
        await waitFor(() => expect(vi.mocked(fetchTimelineMonth)).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
        expect(screen.queryByText(/(?<!\d)0 件/)).not.toBeInTheDocument();
        expect(screen.queryByTestId('timeline-photos')).not.toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'この月のできごと' })).not.toBeInTheDocument();
    });
});
