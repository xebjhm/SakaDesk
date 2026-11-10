import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import i18n from '../../../i18n';
import { server } from '../../../__tests__/mocks/server';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
import { openChat } from '../../../shell/openChat';
import { Swimlanes } from './Swimlanes';
import { dayPayload, MIKU, NAO } from './__fixtures__';
import { memoryMessage } from '../__fixtures__/memories';

beforeAll(async () => { await i18n.changeLanguage('en'); });
// MessageBubble asks for cached translations of what it shows.
beforeEach(() => { server.use(http.get('/api/app-state/translations', () => HttpResponse.json({}))); });

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

    it('labels the hour ruler from the first hour to the end of the last', () => {
        const data = dayPayload();
        render(<Swimlanes members={data.members} messages={data.messages} />);
        const hours = screen.getAllByTestId('day-ruler-hour');
        const first = new Date('2024-09-14T04:02:00Z');
        const last = new Date('2024-09-14T12:52:00Z');
        const pad = (n: number) => String(n).padStart(2, '0');
        expect(hours[0]).toHaveTextContent(`${pad(first.getHours())}:00`);
        expect(hours[hours.length - 1]).toHaveTextContent(`${pad((last.getHours() + 1) % 24)}:00`);
    });

    it('places a later card lower than an earlier one in the same lane', () => {
        const data = dayPayload();
        render(<Swimlanes members={data.members} messages={data.messages} />);
        const [a, b] = within(screen.getAllByTestId('day-lane')[0]).getAllByTestId('day-lane-card');
        expect(parseFloat(a.style.top)).toBeLessThan(parseFloat(b.style.top));
    });

    it('expands a card on click with her full words and a jump to the chat', async () => {
        const long = '今日は本当にありがとう。'.repeat(8);
        render(<Swimlanes members={[MIKU, NAO]} messages={[memoryMessage({ id: 5, text: long })]} />);
        expect(screen.queryByRole('button', { name: 'View in chat' })).toBeNull();
        await userEvent.click(screen.getByRole('button', { expanded: false }));
        expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
        expect(screen.getByTestId('day-lane-card').textContent).toContain(long);
        await userEvent.click(screen.getByRole('button', { name: 'View in chat' }));
        expect(vi.mocked(openChat)).toHaveBeenCalledWith(expect.objectContaining({ message_id: 5, name: '金村 美玖' }));
    });
});
