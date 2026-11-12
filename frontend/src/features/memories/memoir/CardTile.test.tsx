import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { installMediaTileHarness } from '../../../__tests__/mediaTileHarness';
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
        // a short name (the title); the date is the description, her words are not in the name
        const button = within(tile).getByRole('button', { name: '最初のメッセージ' });
        expect(button).toHaveAccessibleDescription('2024/7/24');
        await userEvent.click(button);
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: 'first.message' }));
    });

    it('shows a photo face from its thumbnail', async () => {
        const h = installMediaTileHarness();
        renderTile(card({
            key: 'first.picture',
            face: face({ type: 'picture', text: null, media_url: '/api/content/media/hinatazaka46/p.jpg', media_file: 'messages/p.jpg' }),
        }));
        // the thumbnail route, not the full file
        expect(within(screen.getByTestId('card-tile')).getByTestId('memory-thumb')).toBeInTheDocument();
        await waitFor(() => expect(h.requested()).toHaveLength(1));
        expect(h.requested()[0]).toContain('/api/content/thumb/');
        vi.unstubAllGlobals();
        expect(screen.queryByTestId('memory-text')).toBeNull();
    });

    it('draws an unearned card as a dashed silhouette with its condition and a neutral progress bar', () => {
        renderTile(cardOf('count.messages.1000'));
        const tile = screen.getByTestId('card-tile');
        expect(tile).toHaveAttribute('data-earned', 'false');
        expect(tile).toHaveClass('border-dashed', 'border-memories-silhouette');
        expect(tile).toHaveTextContent('1,000通目が届いたら');
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
        // the sweep leaves the card under reduced motion: only the still sheen stays
        expect(shimmer).toHaveClass('bg-memories-foil', 'animate-shimmer', 'motion-reduce:hidden');
    });

    it('keeps the foil off ordinary cards and silhouettes', () => {
        renderTile(cardOf('first.message'));
        expect(screen.queryByTestId('card-foil')).toBeNull();
    });

    it('draws an unearned foil card as a plain silhouette', () => {
        renderTile(card({ key: 'moment.synchro', earned: false, foil: true, rare: true, date: null }));
        expect(screen.queryByTestId('card-foil')).toBeNull();
        expect(screen.getByTestId('card-tile')).toHaveTextContent('別々の日に、同じ時刻のメッセージ');
    });

    it('formats large numbers with the locale separators', () => {
        renderTile(card({ key: 'count.messages.10000', foil: true, face: face() }));
        expect(screen.getByTestId('card-tile')).toHaveTextContent('10,000通目');
    });

    it('keeps the memorial foil of the graduation card still', () => {
        renderTile(card({ key: 'grad.last', foil: true, face: face({ text: 'ありがとう' }) }));
        expect(screen.getByTestId('card-foil')).toHaveClass('bg-memories-foil');
        expect(screen.queryByTestId('card-foil-shimmer')).toBeNull();
    });

    it('draws a special day as a postmarked postcard stack that opens the card', async () => {
        const onOpen = vi.fn();
        render(
            <NicknameProvider nickname="みーぱん">
                <CardTile card={cardOf('special.newyear')} onOpen={onOpen} sender={{ name: '金村 美玖', oshi: true }} />
            </NicknameProvider>,
        );
        const tile = screen.getByTestId('card-tile');
        expect(tile).toHaveAttribute('data-postcard', 'newyear');
        // no 「×N」 fold any more: one focusable stack named by the title, described by the count and years
        expect(screen.queryByText('×3')).toBeNull();
        const stack = within(tile).getByRole('button', { name: '元旦' });
        expect(stack).toHaveAccessibleDescription('はがき 3 枚 ・ 2024・2025・2026');
        expect(stack).not.toHaveAttribute('aria-expanded');
        // the newest year on top, each layer postmarked with its year
        const layers = within(stack).getAllByTestId('postcard-layer');
        expect(layers.map((l) => l.getAttribute('data-year'))).toEqual(['2026', '2025', '2024']);
        expect(within(layers[0]).getByTestId('postcard-postmark')).toHaveTextContent('2026');
        expect(within(layers[0]).getByTestId('postcard-postmark')).toHaveTextContent('1.1');
        expect(within(layers[0]).getByTestId('memory-text')).toHaveTextContent('あけおめ！');
        expect(layers[0]).toHaveTextContent('謹賀新年');
        expect(layers[0]).toHaveTextContent('金村 美玖 より');
        // the oshi pink only for the ♥
        expect(within(layers[0]).getByTestId('postcard-oshi')).toHaveClass('text-semantic-oshi-solid');
        expect(within(layers[1]).queryByTestId('memory-text')).toBeNull();
        await userEvent.click(stack);
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: 'special.newyear' }));
    });

    it('fans the stack on hover or focus only when motion is allowed', () => {
        renderTile(cardOf('special.newyear'));
        const layers = screen.getAllByTestId('postcard-layer');
        for (const layer of layers) {
            expect(layer).toHaveClass('motion-reduce:transition-none');
            const fan = [...layer.classList].filter((c) => c.includes('group-hover') || c.includes('group-focus-visible'));
            expect(fan.length).toBeGreaterThan(0);
            // every fan class is gated on motion-safe: under reduced motion the layers stay still
            expect(fan.every((c) => c.startsWith('motion-safe:'))).toBe(true);
        }
    });

    it('draws a single year as one postcard that does not fan', () => {
        renderTile(card({ key: 'special.join_day', date: '2024-07-24', face: face({ text: 'ありがとう🌸' }) }));
        const layers = screen.getAllByTestId('postcard-layer');
        expect(layers).toHaveLength(1);
        expect([...layers[0].classList].some((c) => c.includes('group-hover'))).toBe(false);
        expect(screen.getByTestId('card-tile')).toHaveAttribute('data-postcard', 'anniversary');
        expect(screen.getByTestId('postcard-band')).toHaveClass('bg-accent-subtle');
        expect(screen.getByRole('button', { name: '加入記念日' })).toHaveAccessibleDescription('はがき 1 枚 ・ 2024');
    });

    it('themes the birthday as a birthday card with the foil band', () => {
        renderTile(card({ key: 'special.birthday', foil: true, date: '2025-02-28', face: face({ text: 'ありがとう' }) }));
        expect(screen.getByTestId('card-tile')).toHaveAttribute('data-postcard', 'birthday');
        expect(screen.getByTestId('postcard-band')).toHaveClass('bg-memories-foil');
        expect(screen.getByTestId('card-tile')).toHaveTextContent('お誕生日おめでとう');
    });

    it('leaves an unearned special day a silhouette', () => {
        renderTile(card({ key: 'special.birthday', earned: false, date: null }));
        expect(screen.queryByTestId('postcard-stack')).toBeNull();
        expect(screen.getByTestId('card-tile')).toHaveAttribute('data-earned', 'false');
    });

    it('shows the あなた shelf as an envelope and a date, never her words; a click opens the letter', async () => {
        const onOpen = renderTile(card({
            key: 'you.letter.1', date: '2024-08-01', letter: { date: '2024-08-01', member_path: 'p', id: 7 },
            // even a stray face must never be shown next to the fan's letter
            face: face({ text: 'ひみつ' }),
        }));
        const tile = screen.getByTestId('card-tile');
        expect(within(tile).getByTestId('card-envelope')).toBeInTheDocument();
        expect(tile).toHaveTextContent('はじめて送った手紙');
        expect(tile).toHaveTextContent('2024/8/1');
        expect(screen.queryByTestId('memory-text')).toBeNull();
        expect(tile).not.toHaveTextContent('ひみつ');
        await userEvent.click(within(tile).getByRole('button', { name: 'はじめて送った手紙' }));
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: 'you.letter.1', letter: expect.objectContaining({ id: 7 }) }));
    });

    it('shows the new avatar on a change card', () => {
        renderTile(cardOf('change.avatar.2025-03-01'));
        const tile = screen.getByTestId('card-tile');
        expect(tile).toHaveTextContent('新しい写真');
        expect(within(tile).getByRole('img', { name: '新しい写真' })).toBeInTheDocument();
        expect(tile).toHaveTextContent('新しいアイコン！');
    });
});
