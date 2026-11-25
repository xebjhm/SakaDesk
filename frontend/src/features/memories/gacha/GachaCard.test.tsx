import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { installMediaTileHarness } from '../../../__tests__/mediaTileHarness';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { NicknameProvider } from '../shared/useNickname';
import { stopMemoriesVoices, useVoicePlayback } from '../shared/voicePlayback';
import type { GachaPull } from '../types';
import { GachaCard, type GachaCardProps } from './GachaCard';
import { gachaPull, missingPull } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('ja'); });
beforeEach(() => { stopMemoriesVoices(); });

function renderCard(pull: GachaPull = gachaPull(), over: Partial<GachaCardProps> = {}) {
    const onToggleFavorite = vi.fn();
    const onContext = vi.fn();
    const utils = render(
        <NicknameProvider nickname="みーぱん">
            <GachaCard pull={pull} favorited={false} onToggleFavorite={onToggleFavorite} onContext={onContext} reducedMotion={false} {...over} />
        </NicknameProvider>,
    );
    return { onToggleFavorite, onContext, ...utils };
}

describe('GachaCard', () => {
    it('shows the rarity, its reason, her words, her name and the JST date and time', () => {
        renderCard();
        const card = screen.getByTestId('gacha-card');
        expect(card).toHaveAttribute('data-rarity', 'n');
        expect(screen.getByText('ノーマル')).toBeInTheDocument();
        expect(screen.getByText('メッセージ')).toBeInTheDocument();
        const words = screen.getByText(/みーぱん、おはよう/);
        expect(words.closest('[lang="ja"]')).not.toBeNull();
        expect(screen.getByText('金村 美玖')).toHaveAttribute('lang', 'ja');
        // 12:52 UTC is 21:52 in Tokyo.
        expect(card).toHaveTextContent(/2024.*9.*14.*21:52/);
    });

    it('shows a photo through the thumbnail route', async () => {
        const h = installMediaTileHarness();
        renderCard(gachaPull({ reason: 'photo' }, {
            type: 'picture', text: null, caption: 'きれい', media_url: '/api/content/media/x.jpg',
        }));
        await waitFor(() => expect(h.requested()).toHaveLength(1));
        expect(h.requested()[0]).toContain('/api/content/thumb');
        vi.unstubAllGlobals();
        expect(screen.getByText('きれい')).toBeInTheDocument();
        expect(screen.getByText('写真')).toBeInTheDocument();
    });

    it('plays a voice through the shared voice coordinator', async () => {
        renderCard(gachaPull({ rarity: 'r', reason: 'voice' }, {
            id: 9, type: 'voice', text: null, media_url: '/api/content/media/v.m4a', duration_s: 12,
        }));
        expect(document.querySelector('audio')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: /ボイスを再生|再生/ }));
        expect(useVoicePlayback.getState().playing).toBe('gacha|messages/34 金村 美玖/58 金村 美玖|9');
        expect(document.querySelector('audio')).not.toBeNull();
    });

    it('an SR card wears the foil, with one sweep', () => {
        renderCard(gachaPull({ rarity: 'sr', reason: 'midnight' }));
        expect(screen.getByText('SR')).toBeInTheDocument();
        expect(screen.getByText('日付が変わった瞬間')).toBeInTheDocument();
        expect(screen.getByTestId('gacha-foil')).toHaveClass('bg-memories-foil');
        expect(screen.getByTestId('gacha-foil-sweep')).toHaveClass('animate-shimmer');
    });

    it('the SR foil is static under reduced motion', () => {
        renderCard(gachaPull({ rarity: 'sr', reason: 'birthday' }), { reducedMotion: true });
        expect(screen.getByTestId('gacha-foil')).toHaveClass('bg-memories-foil');
        expect(screen.queryByTestId('gacha-foil-sweep')).toBeNull();
        expect(document.querySelector('.animate-shimmer')).toBeNull();
    });

    it('an N or R card has no foil', () => {
        renderCard(gachaPull({ rarity: 'r', reason: 'nickname' }));
        expect(screen.queryByTestId('gacha-foil')).toBeNull();
    });

    it('the ★ button reflects and toggles the favourite in the star yellow', async () => {
        const { onToggleFavorite, rerender } = renderCard();
        const off = screen.getByRole('button', { name: '★をつける' });
        expect(off).toHaveAttribute('aria-pressed', 'false');
        await userEvent.click(off);
        expect(onToggleFavorite).toHaveBeenCalledTimes(1);
        rerender(
            <NicknameProvider nickname="みーぱん">
                <GachaCard pull={gachaPull()} favorited onToggleFavorite={onToggleFavorite} onContext={vi.fn()} reducedMotion={false} />
            </NicknameProvider>,
        );
        const on = screen.getByRole('button', { name: '★をはずす' });
        expect(on).toHaveAttribute('aria-pressed', 'true');
        expect(on.innerHTML).toContain('text-semantic-star');
    });

    it('the context link opens the day around the message', async () => {
        const { onContext } = renderCard();
        await userEvent.click(screen.getByRole('button', { name: 'この日の前後を見る' }));
        expect(onContext).toHaveBeenCalledTimes(1);
    });

    it('a pull no longer in the archive is a date-only card', () => {
        const { container } = renderCard(missingPull());
        expect(screen.getByText('このメッセージは見つかりませんでした')).toBeInTheDocument();
        expect(screen.getByTestId('gacha-card')).toHaveTextContent(/2026.*11.*8/);
        expect(container.textContent).not.toMatch(/\d{2}:\d{2}/);
        expect(screen.queryByRole('button', { name: '★をつける' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'この日の前後を見る' })).toBeNull();
        expect(screen.queryByText('金村 美玖')).toBeNull();
    });
});
