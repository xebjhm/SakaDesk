import { describe, it, expect, vi, afterAll, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import i18n from '../../../i18n';
import { server } from '../../../__tests__/mocks/server';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
import { openChat } from '../../../shell/openChat';
import { clientLog } from '../../../utils/clientLog';
import { Swimlanes } from './Swimlanes';
import { dayMessage, dayPayload, MIKU, NAO } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('en'); });
// MessageBubble asks for cached translations and transcripts of what it shows (and saves a translation).
beforeEach(() => {
    server.use(
        http.get('/api/app-state/translations', () => HttpResponse.json({})),
        http.patch('/api/app-state/translations', () => HttpResponse.json({})),
        http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })),
    );
});

describe('Swimlanes', () => {
    it('draws one column per member with her name on top', () => {
        const data = dayPayload();
        render(<Swimlanes members={data.members} messages={data.messages} />);
        const lanes = screen.getAllByTestId('day-lane');
        expect(lanes).toHaveLength(2);
        expect(within(lanes[0]).getByText('金村 美玖')).toHaveAttribute('lang', 'ja');
        expect(within(lanes[0]).getAllByTestId('day-lane-card')).toHaveLength(2);
        expect(within(lanes[1]).getAllByTestId('day-lane-card')).toHaveLength(1);
    });

    it('labels the JST hour ruler from the first hour to the end of the last', () => {
        const data = dayPayload();
        render(<Swimlanes members={data.members} messages={data.messages} />);
        const hours = screen.getAllByTestId('day-ruler-hour').map((h) => h.textContent);
        // 13:02 JST … 21:52 JST
        expect(hours[0]).toBe('13:00');
        expect(hours[hours.length - 1]).toBe('22:00');
        expect(hours).toHaveLength(10);
    });

    describe('for a viewer in UTC+8', () => {
        const savedTz = process.env.TZ;
        beforeAll(() => { process.env.TZ = 'Asia/Taipei'; });
        afterAll(() => { process.env.TZ = savedTz; });

        it('shows a 00:30 JST message at 00:30 under its own date, never 23:30', () => {
            // 2024-09-14 00:30 JST = 2024-09-13 15:30 UTC = 23:30 in Taipei.
            const early = dayMessage(MIKU, { id: 11, ts: '2024-09-13T15:30:00Z', text: 'まだ起きてる' });
            const late = dayMessage(MIKU, { id: 12, ts: '2024-09-14T14:10:00Z', text: 'おやすみ' });
            render(<Swimlanes members={[MIKU]} messages={[early, late]} />);
            const cards = screen.getAllByTestId('day-lane-card');
            expect(cards[0]).toHaveTextContent('00:30');
            expect(cards[1]).toHaveTextContent('23:10');
            const hours = screen.getAllByTestId('day-ruler-hour').map((h) => h.textContent);
            expect(hours[0]).toBe('00:00');
            expect(hours[hours.length - 1]).toBe('24:00');
            expect(document.body.textContent).not.toContain('23:30');
        });
    });

    it('places a later card lower than an earlier one in the same lane', () => {
        const data = dayPayload();
        render(<Swimlanes members={data.members} messages={data.messages} />);
        const [a, b] = within(screen.getAllByTestId('day-lane')[0]).getAllByTestId('day-lane-card');
        expect(parseFloat(a.style.top)).toBeLessThan(parseFloat(b.style.top));
    });

    it('expands a card on click with her full words and a jump to the chat', async () => {
        const long = '今日は本当にありがとう。'.repeat(8);
        vi.mocked(clientLog).mockClear();
        render(<Swimlanes members={[MIKU, NAO]} messages={[dayMessage(MIKU, { id: 5, text: long })]} />);
        expect(screen.queryByRole('button', { name: 'View in chat' })).toBeNull();
        await userEvent.click(screen.getByRole('button', { expanded: false }));
        expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
        expect(screen.getByTestId('day-lane-card').textContent).toContain(long);
        await userEvent.click(screen.getByRole('button', { name: 'View in chat' }));
        expect(vi.mocked(openChat)).toHaveBeenCalledWith(expect.objectContaining({ message_id: 5, name: '金村 美玖' }));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'lane_card', outcome: 'on' });
    });

    it('shows a video as a video still, never in an image, and expands it read-only', async () => {
        const video = dayMessage(NAO, { id: 6, type: 'video', text: null, media_url: '/api/content/media/v.mp4', media_file: 'messages/1/video/6.mp4' });
        render(<Swimlanes members={[NAO]} messages={[video]} />);
        const card = screen.getByTestId('day-lane-card');
        expect(card.querySelector('img')).toBeNull();
        expect(within(card).getByTestId('memory-thumb-video')).toHaveAttribute('src', '/api/content/media/v.mp4');
        await userEvent.click(screen.getByRole('button', { expanded: false }));
        fireEvent.contextMenu(screen.getByTestId('day-lane-card').querySelector('video')!);
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('keeps the lane headers above an expanded card', () => {
        const data = dayPayload();
        render(<Swimlanes members={data.members} messages={data.messages} />);
        const header = screen.getAllByTestId('day-lane')[0].querySelector('header')!;
        expect(header.className).toContain('z-20');
    });
});
