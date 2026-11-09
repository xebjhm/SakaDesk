import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../../i18n';
import { S03Clock } from './S03Clock';
import { clockData, payload } from '../__fixtures__/payload';
import type { S03ClockData } from '../api';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const renderS03 = (data: S03ClockData, reducedMotion = false) =>
    render(<S03Clock data={data} fallback={data.band ? 'flat' : null} recap={payload()} nickname="ゆき" reducedMotion={reducedMotion} onMediaEnd={() => {}} />);

describe('S03Clock', () => {
    it('draws one star per message on a clock with no axis numbers and four faint cardinal dots', () => {
        renderS03(clockData());
        const clock = screen.getByRole('img', { name: '彼女の一日の星時計' });
        expect(clock.tagName.toLowerCase()).toBe('svg');
        expect(screen.getAllByTestId('s03-star')).toHaveLength(5);
        expect(screen.getAllByTestId('s03-cardinal')).toHaveLength(4);
        expect(clock.textContent).toBe('');
    });

    it('glows the peak hour and shows its message under the night title', () => {
        renderS03(clockData());
        expect(screen.getByText('彼女の夜は、あなたの夜。')).toHaveAttribute('data-voice', 'narration');
        expect(screen.getByTestId('s03-glow')).toBeInTheDocument();
        expect(screen.getAllByTestId('s03-star').filter((s) => s.getAttribute('data-peak') === 'true')).toHaveLength(3);
        expect(screen.getByText('いちばん星が集まる時間の、ひとこと。')).toBeInTheDocument();
        expect(screen.getByText('ゆき、今日もおつかれさま')).toHaveAttribute('data-voice', 'quote');
    });

    it('shows the longest streak from 7 days only', () => {
        const { unmount } = renderS03(clockData({ longest_streak: 12 }));
        expect(screen.getByText('12日つづけて、彼女のことばが届いた。')).toBeInTheDocument();
        unmount();
        renderS03(clockData({ longest_streak: null }));
        expect(screen.queryByText(/日つづけて/)).toBeNull();
    });

    it('a flat day: the band title, no glow, the every-hour line', () => {
        renderS03(clockData({ band: 'morning' }));
        expect(screen.getByText('彼女の朝は、あなたの朝。')).toBeInTheDocument();
        expect(screen.queryByTestId('s03-glow')).toBeNull();
        expect(screen.getByText('どの時間にも、彼女のことばがあった。')).toBeInTheDocument();
        expect(screen.queryByText('いちばん星が集まる時間の、ひとこと。')).toBeNull();
    });

    it('stars fall in within 2 s, and stay still with reduced motion', () => {
        const { unmount } = renderS03(clockData());
        const delays = screen.getAllByTestId('s03-star').map((s) => parseFloat((s as unknown as HTMLElement).style.animationDelay));
        expect(Math.max(...delays)).toBeLessThan(2000);
        expect(screen.getAllByTestId('s03-star')[0].getAttribute('class')).toMatch(/animate-star-fall/);
        unmount();
        renderS03(clockData(), true);
        for (const s of screen.getAllByTestId('s03-star')) {
            expect(s.getAttribute('class') ?? '').not.toMatch(/animate-/);
            expect((s as unknown as HTMLElement).style.animationDelay).toBe('');
        }
        expect(document.body.innerHTML).not.toMatch(/\banimate-/);
    });

    it('reads its colours from CSS variables', () => {
        renderS03(clockData());
        for (const s of screen.getAllByTestId('s03-star')) {
            expect((s as unknown as HTMLElement).style.fill).toMatch(/^var\(--ds-/);
        }
        expect(document.body.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    });

    it('never prints null or a zero without a message or a streak', () => {
        renderS03(clockData({ representative: null, longest_streak: null, stars: [{ h: 0, m: 0, type: 'text' }], peak_hour: 0 }));
        expect(document.body.textContent).not.toMatch(/null|undefined|NaN|0/);
    });
});
