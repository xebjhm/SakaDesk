import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchDay: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { openChat } from '../../../shell/openChat';
import { fetchDay } from '../api';
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
        const onClose = renderDetail(card({ key: 'first.message', date: '2024-07-24', face: face({ id: 1, text: '%%%、はじめまして！' }) }));
        const dialog = await screen.findByRole('dialog');
        expect(vi.mocked(fetchDay).mock.calls[0]?.[1]).toEqual({ date: '2024-07-24', member: MEMBER_PATH });
        expect(await within(dialog).findByTestId('day-merged')).toHaveTextContent('おやすみ');
        expect(within(dialog).getByTestId('card-tile')).toHaveTextContent('最初のメッセージ');

        await userEvent.click(within(dialog).getByRole('button', { name: /トークで見る/ }));
        expect(vi.mocked(openChat)).toHaveBeenCalledWith(expect.objectContaining({ path: MEMBER_PATH, message_id: 1, name: '金村 美玖' }));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_jump', { target: 'binder', has_target: true });
        expect(onClose).toHaveBeenCalled();
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

    it('shows the old and new avatar, the days with the new one and the last and first messages', async () => {
        renderDetail(changeCard());
        const change = await screen.findByTestId('card-detail-change');
        expect(within(change).getByRole('img', { name: '前の写真' })).toBeInTheDocument();
        expect(within(change).getByRole('img', { name: '新しい写真' })).toBeInTheDocument();
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
