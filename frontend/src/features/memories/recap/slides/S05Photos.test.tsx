import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../../i18n';
import { S05Photos, FAN_MS } from './S05Photos';
import { message, payload, photosData } from '../__fixtures__/payload';
import type { S05PhotosData } from '../api';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const renderS05 = (data: S05PhotosData, fallback: string | null = null, reducedMotion = false) =>
    render(<S05Photos data={data} fallback={fallback} recap={payload()} nickname="ゆき" reducedMotion={reducedMotion} onMediaEnd={() => {}} />);

const delayOf = (el: HTMLElement) => parseFloat(el.style.animationDelay || '0');

describe('S05Photos', () => {
    it('a soft wall of the year\'s photos behind the burst, skipping missing ones', () => {
        renderS05(photosData());
        const wall = screen.getByTestId('s05-wall');
        expect(wall).toHaveAttribute('aria-hidden', 'true');
        expect(wall.querySelectorAll('img')).toHaveLength(4);
        expect(screen.getByText('見せたかった景色。')).toBeInTheDocument();
    });

    it('fans the burst out at compressed real timing, with its caption', () => {
        renderS05(photosData());
        const items = screen.getAllByTestId('s05-burst-item');
        expect(items).toHaveLength(4);
        const delays = items.map(delayOf);
        for (let i = 1; i < delays.length; i += 1) expect(delays[i]).toBeGreaterThan(delays[i - 1]);
        expect(delays[delays.length - 1]).toBeLessThanOrEqual(FAN_MS);
        // 20 s, then 40 s, then 120 s apart: the gaps keep their order.
        expect(delays[3] - delays[2]).toBeGreaterThan(delays[2] - delays[1]);
        expect(items[0].style.transform).toMatch(/rotate/);
        expect(items[3].querySelector('video')).not.toBeNull();
        expect(items[0].querySelector('img')).toHaveAttribute('src', '/api/media/b10.jpg');
        expect(screen.getByText('ゆきに見せたかった海')).toHaveAttribute('data-voice', 'quote');
        expect(screen.getByRole('group', { name: '一度に届いた写真' })).toBeInTheDocument();
    });

    it('the mostly-bursts line', () => {
        renderS05(photosData({ mostly_bursts: true }));
        expect(screen.getByText('彼女は、いつもまとめて見せてくれる人。')).toHaveAttribute('data-voice', 'narration');
    });

    it('the best-photo fallback: one photo with her words and no burst', () => {
        renderS05(photosData({
            burst: [], burst_caption: null, wall: undefined,
            best_photo: message(30, '%%%、きれいでしょ', { type: 'picture', media_url: '/api/media/best.jpg' }),
        }), 'best_photo');
        expect(screen.queryAllByTestId('s05-burst-item')).toHaveLength(0);
        expect(screen.queryByTestId('s05-wall')).toBeNull();
        expect(screen.getByTestId('s05-best')).toBeInTheDocument();
        expect(screen.getByTestId('s05-best').querySelector('img')).toHaveAttribute('src', '/api/media/best.jpg');
        expect(screen.getByText('ゆき、きれいでしょ')).toBeInTheDocument();
        expect(screen.getByText('今年の、とっておきの一枚。')).toBeInTheDocument();
    });

    it('reduced motion: a still row, no fanning and no animation', () => {
        renderS05(photosData(), null, true);
        for (const item of screen.getAllByTestId('s05-burst-item')) {
            expect(item.style.transform).toBe('');
            expect(item.style.animationDelay).toBe('');
        }
        expect(document.body.innerHTML).not.toMatch(/\banimate-/);
    });

    it('never prints null, undefined or a number', () => {
        renderS05(photosData({ burst_caption: null }));
        expect(document.body.textContent).not.toMatch(/null|undefined|NaN|\d/);
    });
});
