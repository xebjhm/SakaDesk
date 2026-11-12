import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchDay: vi.fn(), fetchCapsule: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { openChat } from '../../../shell/openChat';
import { fetchCapsule, fetchDay } from '../api';
import { MEMBER_PATH } from '../__fixtures__/memories';
import { dayMessage, dayPayload, MIKU } from '../day/__fixtures__';
import { NicknameProvider } from '../shared/useNickname';
import type { BinderCard } from '../types';
import { CardDetail } from './CardDetail';
import { binderPayload, card, face } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('ja'); });
// MessageBubble asks for cached translations and transcripts of what it shows.
beforeEach(() => {
    server.use(
        http.get('/api/app-state/translations', () => HttpResponse.json({})),
        http.patch('/api/app-state/translations', () => HttpResponse.json({})),
        http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })),
    );
});
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    vi.mocked(openChat).mockClear();
    vi.mocked(fetchCapsule).mockReset().mockResolvedValue({ notes: [] });
    vi.mocked(fetchDay).mockReset().mockResolvedValue(dayPayload({
        members: [MIKU],
        messages: [
            dayMessage(MIKU, { id: 1, ts: '2024-07-24T03:00:00Z', text: '%%%、はじめまして！' }),
            dayMessage(MIKU, { id: 2, ts: '2024-07-24T12:00:00Z', text: 'おやすみ' }),
        ],
    }));
});

const changeCard = () => binderPayload().shelves.find((s) => s.key === 'change')!.cards[0];

function renderDetail(c: BinderCard, onClose = vi.fn()) {
    render(
        <NicknameProvider nickname="みーぱん">
            <CardDetail service="hinatazaka46" memberPath={MEMBER_PATH} name="金村 美玖" card={c} onClose={onClose} />
        </NicknameProvider>,
    );
    return onClose;
}

describe('CardDetail', () => {
    it('loads the day of the card and jumps to her chat at the card message', async () => {
        const onClose = renderDetail(card({
            key: 'first.message', date: '2024-07-24', face: face({ id: 1, ts: '2024-07-24T03:00:00Z', text: '%%%、はじめまして！' }),
        }));
        const dialog = await screen.findByRole('dialog');
        expect(vi.mocked(fetchDay).mock.calls[0]?.[1]).toEqual({ date: '2024-07-24', member: MEMBER_PATH });
        expect(await within(dialog).findByTestId('day-merged')).toHaveTextContent('おやすみ');
        expect(within(dialog).getByTestId('card-tile')).toHaveTextContent('最初のメッセージ');

        await userEvent.click(within(dialog).getByRole('button', { name: /トークで見る/ }));
        expect(vi.mocked(openChat)).toHaveBeenCalledWith(expect.objectContaining({ path: MEMBER_PATH, message_id: 1, name: '金村 美玖' }));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_jump', { target: 'binder', has_target: true });
        expect(onClose).toHaveBeenCalled();
    });

    it('lets either message of a pair card drive the day and the jump (keyboard too)', async () => {
        const onClose = renderDetail(card({
            key: 'record.greeting_pair', date: '2024-07-24',
            face: face({ id: 1, ts: '2024-07-24T03:00:00Z', text: 'おはよう！早起き' }),
            refs: { pair: face({ id: 6, ts: '2024-12-01T18:30:00Z', text: 'おやすみ、遅くなっちゃった' }) },
        }));
        const pair = await screen.findByTestId('card-detail-pair');
        const early = within(pair).getByRole('button', { name: /いちばん早いおはよう/ });
        const late = within(pair).getByRole('button', { name: /いちばん遅いおやすみ/ });
        expect(early).toHaveAttribute('aria-pressed', 'true');
        expect(late).toHaveAttribute('aria-pressed', 'false');
        expect(vi.mocked(fetchDay).mock.calls[0]?.[1]).toEqual({ date: '2024-07-24', member: MEMBER_PATH });
        // the first message is the default and is highlighted in the day
        const row = await screen.findByTestId('day-merged');
        await waitFor(() => expect(within(row).getAllByTestId('day-merged-row')[0]).toHaveAttribute('data-focused', 'true'));

        late.focus();
        await userEvent.keyboard('{Enter}');
        expect(late).toHaveAttribute('aria-pressed', 'true');
        expect(early).toHaveAttribute('aria-pressed', 'false');
        // 18:30Z is 03:30 JST on the next day
        await waitFor(() => expect(vi.mocked(fetchDay).mock.lastCall?.[1]).toEqual({ date: '2024-12-02', member: MEMBER_PATH }));
        expect(screen.getByTestId('card-detail-day-label')).toHaveTextContent('2024');
        expect(screen.getByTestId('card-detail-day-label')).toHaveTextContent('12');

        await userEvent.click(screen.getByRole('button', { name: /トークで見る/ }));
        expect(vi.mocked(openChat)).toHaveBeenCalledWith(expect.objectContaining({ message_id: 6 }));
        expect(onClose).toHaveBeenCalled();
    });

    it('scrolls only the day column to its message, never the dialog body', async () => {
        renderDetail(card({
            key: 'first.message', date: '2024-07-24', face: face({ id: 2, ts: '2024-07-24T12:00:00Z', text: 'おやすみ' }),
        }));
        const dialog = await screen.findByRole('dialog');
        const body = within(dialog).getByTestId('modal-body');
        // from md the body does not scroll: the columns do
        expect(body).toHaveClass('md:overflow-hidden', 'md:flex');
        const scroller = within(dialog).getByTestId('card-detail-day-scroller');
        expect(scroller).toHaveAttribute('data-focus-scroller');
        expect(scroller).toHaveClass('overflow-y-auto', 'min-h-0');
        const row = await within(scroller).findAllByTestId('day-merged-row');
        expect(row[1]).toHaveAttribute('data-focused', 'true');
        expect(body.scrollTop).toBe(0);
        // the focused row lives inside the column scroller, which is inside the body
        expect(scroller.contains(row[1])).toBe(true);
    });

    it('a シンクロ pair is selectable too, by its dates', async () => {
        renderDetail(card({
            key: 'moment.synchro', date: '2024-07-24',
            face: face({ id: 1, ts: '2024-07-24T03:00:00Z', text: '同じ時刻' }),
            refs: { pair: face({ id: 9, ts: '2025-02-01T03:00:00Z', text: 'また同じ時刻' }) },
        }));
        const pair = await screen.findByTestId('card-detail-pair');
        const buttons = within(pair).getAllByRole('button');
        expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
        await userEvent.click(buttons[1]);
        await waitFor(() => expect(vi.mocked(fetchDay).mock.lastCall?.[1]).toEqual({ date: '2025-02-01', member: MEMBER_PATH }));
    });

    it('shows both messages of a pair card', async () => {
        renderDetail(card({
            key: 'record.greeting_pair', date: '2024-07-24',
            face: face({ id: 5, text: 'おはよう！早起き' }),
            refs: { pair: face({ id: 6, ts: '2024-12-01T18:30:00Z', text: 'おやすみ、遅くなっちゃった' }) },
        }));
        const pair = await screen.findByTestId('card-detail-pair');
        expect(pair).toHaveTextContent('おはよう！早起き');
        expect(pair).toHaveTextContent('おやすみ、遅くなっちゃった');
    });

    it('loads the day of an anniversary face from the nearest day and says so, with its real date', async () => {
        renderDetail(card({ key: 'anniv.d100', date: '2024-10-31', face: face({ id: 7, ts: '2024-11-02T03:00:00Z', text: 'きょうも' }) }));
        await waitFor(() => expect(vi.mocked(fetchDay).mock.calls[0]?.[1]).toEqual({ date: '2024-11-02', member: MEMBER_PATH }));
        const label = await screen.findByTestId('card-detail-day-label');
        expect(label).toHaveTextContent('いちばん近い日のメッセージ');
        expect(label).toHaveTextContent('2024年11月2日');
    });

    it('labels a change face from a later day with that day', async () => {
        renderDetail({ ...changeCard(), face: face({ id: 41, ts: '2025-03-03T03:00:00Z', text: 'あとの日' }) });
        await waitFor(() => expect(vi.mocked(fetchDay).mock.calls[0]?.[1]).toEqual({ date: '2025-03-03', member: MEMBER_PATH }));
        const label = await screen.findByTestId('card-detail-day-label');
        expect(label).toHaveTextContent('2025年3月3日');
        expect(label).not.toHaveTextContent('いちばん近い日');
    });

    it('hides the day column of a card without a message', async () => {
        renderDetail(card({ key: 'anniv.y1', date: '2025-07-24', face: null }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByTestId('card-tile')).toBeInTheDocument();
        expect(within(dialog).queryByTestId('card-detail-day')).toBeNull();
        expect(within(dialog).queryByRole('status')).toBeNull();
        expect(vi.mocked(fetchDay)).not.toHaveBeenCalled();
    });

    it('shows the old and new avatar, the days with the new one and the last and first messages', async () => {
        renderDetail(changeCard());
        const change = await screen.findByTestId('card-detail-change');
        expect(within(change).getByRole('img', { name: '前の写真' })).toHaveAttribute('src', expect.stringContaining('old.jpg'));
        expect(within(change).getByRole('img', { name: '新しい写真' })).toHaveAttribute('src', expect.stringContaining('new.jpg'));
        // no second large card repeating the new avatar and the same message
        expect(within(screen.getByRole('dialog')).queryByTestId('card-tile')).toBeNull();
        expect(within(screen.getByRole('dialog')).getAllByText('新しいアイコン！')).toHaveLength(1);
        expect(change).toHaveTextContent('この写真と、120 日');
        expect(change).toHaveTextContent('前のアイコン最後');
        expect(change).toHaveTextContent('新しいアイコン！');
        // one number: the message count stays in the payload
        expect(change).not.toHaveTextContent('345');
    });

    it('shows a graduation card as her last message, without a shimmer', async () => {
        renderDetail(card({ key: 'grad.last', foil: true, date: '2024-07-24', face: face({ id: 2, text: 'ありがとう' }) }));
        const grad = await screen.findByTestId('card-detail-graduation');
        expect(grad).toHaveTextContent('最後のメッセージ');
        expect(grad).toHaveTextContent('ずっと、ここに。');
        expect(screen.getByRole('dialog').querySelector('.animate-shimmer')).toBeNull();
    });
});

describe('CardDetail capsule', () => {
    it('holds a capsule strip anchored on the earned card', async () => {
        renderDetail(card({ key: 'anniv.y1', date: '2024-09-14' }));
        expect(await screen.findByTestId('capsule-strip')).toBeInTheDocument();
        expect(fetchCapsule).toHaveBeenCalledWith('hinatazaka46', { member: MEMBER_PATH, card: 'anniv.y1' }, expect.any(AbortSignal));
    });

    it('has no capsule strip for an unearned card or one without a date', () => {
        renderDetail(card({ key: 'anniv.y2', earned: false, date: null }));
        expect(screen.queryByTestId('capsule-strip')).toBeNull();
        expect(fetchCapsule).not.toHaveBeenCalled();
    });
});
