import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import i18n from '../../../i18n';
import { server } from '../../../__tests__/mocks/server';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchFirstMeet: vi.fn(), fetchDay: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { openChat } from '../../../shell/openChat';
import { fetchDay, fetchFirstMeet } from '../api';
import { MEMBER_PATH } from '../__fixtures__/memories';
import { dayPayload } from '../day/__fixtures__';
import { NicknameProvider } from '../shared/useNickname';
import { FirstMeetPanel } from './FirstMeetPanel';
import { formatElapsed } from './firstMeet';
import { firstMeet } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('zh-TW'); });
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T03:00:00Z'));
    server.use(
        http.get('/api/app-state/translations', () => HttpResponse.json({})),
        http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })),
    );
    vi.mocked(clientLog).mockClear();
    vi.mocked(openChat).mockClear();
    vi.mocked(fetchFirstMeet).mockReset().mockResolvedValue(firstMeet());
    vi.mocked(fetchDay).mockReset().mockResolvedValue(dayPayload());
});
afterEach(() => { vi.useRealTimers(); });

const renderPanel = () => render(
    <NicknameProvider nickname="みーぱん">
        <FirstMeetPanel service="hinatazaka46" memberPath={MEMBER_PATH} name="金村 美玖" />
    </NicknameProvider>,
);

describe('FirstMeetPanel (初見と今)', () => {
    it('draws one row per kind: the first on the left, a recent one on the right, the time between', async () => {
        renderPanel();
        const rows = await screen.findAllByTestId('first-meet-row');
        expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(['ohayo', 'photo']);
        expect(within(rows[0]).getByRole('heading', { name: '早安' })).toBeInTheDocument();
        const [then, now] = within(rows[0]).getAllByTestId('first-meet-side');
        expect(then).toHaveAttribute('data-side', 'then');
        expect(then).toHaveTextContent('はじめてのおはよう、緊張する…！');
        expect(now).toHaveTextContent('おはよ〜 今日も一日がんばろうね☀️');
        // JST date and time on each side (22:40Z is 07:40 JST the next day)
        expect(then).toHaveTextContent('07:40');
        expect(within(rows[0]).getByTestId('first-meet-gap')).toHaveTextContent('1 年 8 天');
        expect(within(rows[1]).getByTestId('first-meet-gap')).toHaveTextContent('5 天');
        expect(screen.getByText('初見')).toBeInTheDocument();
        expect(screen.getByText('現在')).toBeInTheDocument();
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_load', { target: 'then_now', outcome: 'ok', count: 2 });
    });

    it('ages only the older photo', async () => {
        renderPanel();
        const [, photo] = await screen.findAllByTestId('first-meet-row');
        const [then, now] = within(photo).getAllByTestId('first-meet-side');
        expect(within(then).getByTestId('memory-thumb').className).toMatch(/sepia-memories-1/);
        expect(within(now).getByTestId('memory-thumb').className).not.toMatch(/sepia/);
        expect(then).toHaveTextContent('初めて送る写真！');
    });

    it('opens her day at the clicked side, and jumps from there', async () => {
        renderPanel();
        const [row] = await screen.findAllByTestId('first-meet-row');
        const [then] = within(row).getAllByTestId('first-meet-side');
        expect(then).toHaveAccessibleName(/2025/);
        await userEvent.click(then);
        const dialog = await screen.findByRole('dialog');
        await waitFor(() => expect(vi.mocked(fetchDay).mock.calls[0]?.[1]).toEqual({ date: '2025-11-02', member: MEMBER_PATH }));
        await userEvent.click(within(dialog).getByRole('button', { name: /在聊天室查看|トークで見る|聊天/ }));
        expect(vi.mocked(openChat)).toHaveBeenCalledWith(expect.objectContaining({ message_id: 13 }));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_jump', { target: 'timeline', has_target: true });
    });

    it('says so gently, with no number, when no kind has both sides', async () => {
        vi.mocked(fetchFirstMeet).mockResolvedValue(null);
        renderPanel();
        expect(await screen.findByText('第一次和最近的訊息，還湊不成一對。')).toBeInTheDocument();
        expect(screen.queryByTestId('first-meet-row')).toBeNull();
    });

    it('formats the time between in every shape, never 0', () => {
        const t = i18n.getFixedT('en');
        expect(formatElapsed(t, { years: 1, days: 8 })).toBe('1 year, 8 days');
        expect(formatElapsed(t, { years: 2, days: 0 })).toBe('2 years');
        expect(formatElapsed(t, { years: 0, days: 1 })).toBe('1 day');
        expect(formatElapsed(i18n.getFixedT('ja'), { years: 1, days: 8 })).toBe('1年8日');
    });
});
