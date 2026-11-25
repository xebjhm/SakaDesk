import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import i18n from '../../../i18n';
import { server } from '../../../__tests__/mocks/server';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
import { NicknameProvider } from '../shared/useNickname';
import { YearLanes } from './YearLanes';
import { dayYearsPayload, MIKU } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('zh-TW'); });
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    server.use(
        http.get('/api/app-state/translations', () => HttpResponse.json({})),
        http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })),
    );
});

const renderLanes = (payload = dayYearsPayload()) => render(
    <NicknameProvider nickname="みーぱん">
        <YearLanes members={payload.members} years={payload.years} />
    </NicknameProvider>,
);

describe('YearLanes', () => {
    it('draws one column per year, oldest first, on one JST clock axis', () => {
        renderLanes();
        const lanes = screen.getAllByTestId('day-years-lane');
        expect(lanes.map((l) => l.getAttribute('data-year'))).toEqual(['2024', '2025']);
        expect(within(lanes[0]).getByRole('heading', { name: '2024' })).toBeInTheDocument();
        expect(lanes[1]).toHaveTextContent('おはよう！2025');
        const hours = screen.getAllByTestId('day-years-hour').map((h) => h.textContent);
        expect(hours[0]).toBe('07:00');
        expect(hours[hours.length - 1]).toBe('24:00');
        // columns stretch to fill the pane but keep a minimum: many years scroll sideways at 960 px
        expect(lanes[0]).toHaveClass('min-w-56', 'flex-1');
        // the silent stretches collapse into labelled rows
        const quiet = within(lanes[0]).getAllByTestId('day-years-quiet').map((q) => q.textContent);
        expect(quiet).toEqual(['08:00–15:00', '16:00–23:00']);
        expect(screen.getByTestId('day-years')).toHaveClass('w-max');
    });

    it('heads each year with its date and weekday, and keeps the axis corner above the headers', () => {
        renderLanes();
        const [l2024, l2025] = screen.getAllByTestId('day-years-lane');
        // 2024-09-14 was a Saturday, 2025-09-14 a Sunday
        expect(within(l2024).getByTestId('day-years-meta')).toHaveTextContent(/9\/14.*週六.*2 則訊息/);
        expect(within(l2025).getByTestId('day-years-meta')).toHaveTextContent(/9\/14.*週日/);
        expect(screen.getByTestId('day-years-axis')).toHaveClass('sticky', 'left-0', 'z-30');
        expect(screen.getByTestId('day-years-corner')).toHaveClass('sticky', 'top-0', 'bg-sheet');
    });

    it('places the same time of day at the same height in every year', () => {
        renderLanes();
        const [l2024, l2025] = screen.getAllByTestId('day-years-lane');
        const top = (lane: HTMLElement, text: string) => within(lane).getByText(text).closest<HTMLElement>('[data-testid="day-lane-card"]')!.style.top;
        // 07:10 and 07:25 sit in the same hour band, 15 minutes apart
        expect(parseFloat(top(l2025, 'おはよう！2025'))).toBeGreaterThan(parseFloat(top(l2024, 'おはよう☀️ 2024')));
        expect(parseFloat(top(l2025, 'おはよう！2025')) - parseFloat(top(l2024, 'おはよう☀️ 2024'))).toBeLessThan(64);
    });

    it('joins matching kinds with a guide line and shows the quiet stretches', () => {
        renderLanes();
        // おはよう 07:10 ↔ 07:25; the 2024 photo has no 2025 photo, the 2025 おやすみ no 2024 one
        expect(screen.getAllByTestId('day-years-guide')).toHaveLength(1);
        expect(screen.getByTestId('day-years-guides')).toHaveAttribute('aria-hidden', 'true');
        const [l2024, l2025] = screen.getAllByTestId('day-years-lane');
        // 2024 is quiet at 23:00 while 2025 says おやすみ; 2025 is quiet at 15:00 while 2024 sends a photo
        expect(within(l2024).getAllByTestId('day-years-gap').length).toBeGreaterThan(0);
        expect(within(l2025).getAllByTestId('day-years-gap')[0]).toHaveTextContent('這個時段沒有訊息');
    });

    it('ages an older year\'s photo and shows each sender with several people', () => {
        renderLanes();
        const [l2024] = screen.getAllByTestId('day-years-lane');
        const thumb = within(l2024).getByTestId('memory-thumb');
        expect(thumb.className).toMatch(/sepia-memories-/);
        expect(within(l2024).getByRole('img', { name: '小坂 菜緒' })).toBeInTheDocument();
    });

    it('shows no avatars for one person and expands a card on click', async () => {
        const p = dayYearsPayload();
        const solo = { ...p, members: [MIKU], years: p.years.map((y) => ({ ...y, messages: y.messages.filter((m) => m.person_key === MIKU.person_key) })) };
        renderLanes(solo);
        expect(screen.queryByRole('img', { name: '金村 美玖' })).toBeNull();
        const card = screen.getByText('おやすみ🌙').closest('button')!;
        await userEvent.click(card);
        expect(card).toHaveAttribute('aria-expanded', 'true');
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'lane_card', outcome: 'on' });
    });
});
