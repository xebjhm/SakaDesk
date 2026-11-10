import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { NicknameProvider } from '../shared/useNickname';
import { CardTile } from './CardTile';
import { binderPayload, card, face } from './__fixtures__';
import type { BinderCard } from '../types';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const cardOf = (key: string): BinderCard => {
    for (const shelf of binderPayload().shelves) {
        const found = shelf.cards.find((c) => c.key === key);
        if (found) return found;
    }
    throw new Error(key);
};

function renderTile(c: BinderCard, onOpen = vi.fn()) {
    render(<NicknameProvider nickname="みーぱん"><CardTile card={c} onOpen={onOpen} /></NicknameProvider>);
    return onOpen;
}

describe('CardTile', () => {
    it('shows an earned card face up: her words through the nickname, the date and the title', async () => {
        const onOpen = renderTile(cardOf('first.message'));
        const tile = screen.getByTestId('card-tile');
        expect(tile).toHaveAttribute('data-earned', 'true');
        expect(within(tile).getByTestId('memory-text')).toHaveTextContent('みーぱん、はじめまして！');
        expect(within(tile).getByTestId('memory-text')).toHaveClass('line-clamp-4');
        expect(tile).toHaveTextContent('最初のメッセージ');
        expect(tile).toHaveTextContent('2024/7/24');
        await userEvent.click(within(tile).getByRole('button'));
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: 'first.message' }));
    });

    it('shows a photo face from its thumbnail', () => {
        renderTile(card({
            key: 'first.picture',
            face: face({ type: 'picture', text: null, media_url: '/api/content/media/hinatazaka46/p.jpg', media_file: 'messages/p.jpg' }),
        }));
        expect(screen.getByTestId('card-tile').querySelector('img')).toHaveAttribute('src', expect.stringContaining('p.jpg'));
        expect(screen.queryByTestId('memory-text')).toBeNull();
    });

    it('draws an unearned card as a dashed silhouette with its condition and a neutral progress bar', () => {
        renderTile(cardOf('count.messages.1000'));
        const tile = screen.getByTestId('card-tile');
        expect(tile).toHaveAttribute('data-earned', 'false');
        expect(tile).toHaveClass('border-dashed', 'border-memories-silhouette');
        expect(tile).toHaveTextContent('1000通目');
        const bar = within(tile).getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '420');
        expect(bar).toHaveAttribute('aria-valuemax', '1000');
        const fill = within(bar).getByTestId('card-progress-fill');
        expect(fill.className).not.toMatch(/danger/);
        expect(fill).toHaveStyle({ width: '42%' });
        expect(within(tile).queryByRole('button')).toBeNull();
        // one number per element: the bar carries no digits
        expect(bar).toHaveTextContent('');
    });

    it('shows only the condition for an unearned card without progress', () => {
        renderTile(cardOf('first.picture'));
        const tile = screen.getByTestId('card-tile');
        expect(tile).toHaveTextContent('最初の写真が届いたら');
        expect(within(tile).queryByRole('progressbar')).toBeNull();
        expect(tile).not.toHaveTextContent(/\b0\b/);
    });

    it('gives a foil card the foil sheen, static under reduced motion', () => {
        renderTile(cardOf('first.nickname'));
        expect(screen.getByTestId('card-foil')).toHaveClass('bg-memories-foil');
        const shimmer = screen.getByTestId('card-foil-shimmer');
        expect(shimmer).toHaveClass('bg-memories-foil', 'animate-shimmer', 'motion-reduce:animate-none');
    });

    it('keeps the foil off ordinary cards and silhouettes', () => {
        renderTile(cardOf('first.message'));
        expect(screen.queryByTestId('card-foil')).toBeNull();
    });

    it('draws an unearned foil card as a plain silhouette', () => {
        renderTile(card({ key: 'moment.synchro', earned: false, foil: true, rare: true, date: null }));
        expect(screen.queryByTestId('card-foil')).toBeNull();
        expect(screen.getByTestId('card-tile')).toHaveTextContent('シンクロ');
    });

    it('keeps the memorial foil of the graduation card still', () => {
        renderTile(card({ key: 'grad.last', foil: true, face: face({ text: 'ありがとう' }) }));
        expect(screen.getByTestId('card-foil')).toHaveClass('bg-memories-foil');
        expect(screen.queryByTestId('card-foil-shimmer')).toBeNull();
    });

    it('fans a yearly stack out into its year tiles', async () => {
        const onOpen = renderTile(cardOf('special.newyear'));
        const stack = screen.getByRole('button', { name: /元旦/ });
        expect(stack).toHaveTextContent('×3');
        expect(stack).toHaveAttribute('aria-expanded', 'false');
        await userEvent.click(stack);
        expect(stack).toHaveAttribute('aria-expanded', 'true');
        const years = screen.getAllByTestId('card-year');
        expect(years).toHaveLength(3);
        expect(years[0]).toHaveTextContent('2024のあけおめ');
        expect(years[0]).toHaveTextContent('2024/1/1');
        await userEvent.click(within(years[1]).getByRole('button'));
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
            key: 'special.newyear', date: '2025-01-01', face: expect.objectContaining({ id: 20 }), years: [],
        }));
    });

    it('shows the あなた shelf as an envelope and a date, never her words', () => {
        renderTile(card({
            key: 'you.letter.1', date: '2024-08-01', letter: { date: '2024-08-01' },
            // even a stray face must never be shown next to the fan's letter
            face: face({ text: 'ひみつ' }),
        }));
        const tile = screen.getByTestId('card-tile');
        expect(within(tile).getByTestId('card-envelope')).toBeInTheDocument();
        expect(tile).toHaveTextContent('はじめて送った手紙');
        expect(tile).toHaveTextContent('2024/8/1');
        expect(screen.queryByTestId('memory-text')).toBeNull();
        expect(tile).not.toHaveTextContent('ひみつ');
        expect(within(tile).queryByRole('button')).toBeNull();
    });

    it('shows the new avatar on a change card', () => {
        renderTile(cardOf('change.avatar.2025-03-01'));
        const tile = screen.getByTestId('card-tile');
        expect(tile).toHaveTextContent('新しい写真');
        expect(within(tile).getByRole('img', { name: '新しい写真' })).toBeInTheDocument();
        expect(tile).toHaveTextContent('新しいアイコン！');
    });
});
