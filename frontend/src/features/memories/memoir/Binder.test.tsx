import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { clientLog } from '../../../utils/clientLog';
import { NicknameProvider } from '../shared/useNickname';
import { Binder } from './Binder';
import { binderPayload, card, face } from './__fixtures__';
import type { BinderPayload } from '../types';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));

beforeAll(async () => { await i18n.changeLanguage('ja'); });
beforeEach(() => { vi.mocked(clientLog).mockClear(); });

function renderBinder(binder: BinderPayload = binderPayload(), onOpen = vi.fn()) {
    render(<NicknameProvider nickname="みーぱん"><Binder binder={binder} onOpen={onOpen} /></NicknameProvider>);
    return onOpen;
}

describe('Binder', () => {
    it('lays out the shelves in order, each with its serif Japanese title and subtitle', () => {
        renderBinder();
        const shelves = screen.getAllByTestId('binder-shelf');
        expect(shelves.map((s) => s.getAttribute('data-shelf'))).toEqual(['first', 'numbers', 'special', 'you', 'change']);
        const title = within(shelves[0]).getByRole('heading', { name: '初めて' });
        expect(title).toHaveClass('font-display');
        expect(title).toHaveAttribute('lang', 'ja');
        expect(within(shelves[0]).getByTestId('binder-shelf-subtitle')).toBeInTheDocument();
        expect(within(shelves[0]).getAllByTestId('card-tile')).toHaveLength(3);
    });

    it('opens an earned card', async () => {
        const onOpen = renderBinder();
        await userEvent.click(screen.getByRole('button', { name: /最初のメッセージ/ }));
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: 'first.message' }));
    });

    it('never renders her words on the あなた shelf', () => {
        const binder = binderPayload();
        binder.shelves.find((s) => s.key === 'you')!.cards[0].face = face({ text: '手紙の返事みたいな言葉' });
        renderBinder(binder);
        const you = screen.getAllByTestId('binder-shelf').find((s) => s.getAttribute('data-shelf') === 'you')!;
        expect(within(you).queryByTestId('memory-text')).toBeNull();
        expect(you).not.toHaveTextContent('手紙の返事みたいな言葉');
    });

    it('leaves out a card it has no copy for and logs the skip', () => {
        renderBinder({
            progress: { earned: 2, total: 2 },
            shelves: [{ key: 'first', cards: [card({ key: 'first.message', face: face() }), card({ key: 'season.spring', face: face() })] }],
        });
        expect(screen.getAllByTestId('card-tile')).toHaveLength(1);
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_skip', { target: 'binder', reason: 'unknown_card', count: 1 });
    });
});
