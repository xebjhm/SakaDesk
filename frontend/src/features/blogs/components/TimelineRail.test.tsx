import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TimelineRail } from './TimelineRail';
import type { BlogMeta } from '../../../types';
import { formatBlogDate } from '../../../utils/dateFormatters';
import i18n from '../../../i18n';

const DAY = 24 * 60 * 60 * 1000;
const blogs: BlogMeta[] = Array.from({ length: 42 }, (_, i) => ({
    id: String(142 - i),
    title: `春の日記 ${42 - i} 🌸`,
    published_at: new Date(Date.UTC(2026, 10, 3, 9) - i * 9 * DAY).toISOString(),
    url: '',
    thumbnail: null,
    cached: true,
}));

function setup(currentIndex = 0) {
    const onSelect = vi.fn();
    const view = render(<TimelineRail blogs={blogs} currentIndex={currentIndex} onSelect={onSelect} />);
    const rail = screen.getByTestId('timeline-rail');
    // jsdom has no layout: give the rail a 460-px box at the top of the page.
    rail.getBoundingClientRect = () =>
        ({ top: 0, left: 0, right: 56, bottom: 460, width: 56, height: 460, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(rail, 'clientHeight', { value: 460, configurable: true });
    return { ...view, rail, onSelect };
}

const pick = (rail: HTMLElement, clientY: number) => {
    fireEvent.mouseMove(rail, { clientY });
    fireEvent.click(rail);
};

beforeAll(async () => { await i18n.changeLanguage('en'); });

afterEach(() => vi.useRealTimers());

describe('TimelineRail', () => {
    it('maps a click to the post at that height: top newest, bottom oldest', () => {
        const { rail, onSelect } = setup();
        pick(rail, 30);
        expect(onSelect).toHaveBeenLastCalledWith(0);
        pick(rail, 430);
        expect(onSelect).toHaveBeenLastCalledWith(41);
        pick(rail, 230); // (230 - 30) / 400 = 0.5 → round(20.5)
        expect(onSelect).toHaveBeenLastCalledWith(21);
        pick(rail, 250); // 0.55 × 41 = 22.55 → 23
        expect(onSelect).toHaveBeenLastCalledWith(23);
    });

    it('zooms in around the pointer after a dwell, which changes the mapping', () => {
        vi.useFakeTimers();
        const { rail, onSelect } = setup();
        pick(rail, 230); // post 21; the dwell timer starts here
        expect(onSelect).toHaveBeenLastCalledWith(21);
        act(() => { vi.advanceTimersByTime(800); }); // dwell → zoom around post 21
        pick(rail, 250); // unzoomed this is 23 (first test); zoomed, posts near 21 are 5× apart: 21
        expect(onSelect).toHaveBeenLastCalledWith(21);
    });

    it('shows the position counted from the oldest post', () => {
        setup(0);
        expect(screen.getByText('42/42')).toBeInTheDocument();
    });

    it('renders nothing without posts', () => {
        const { container } = render(<TimelineRail blogs={[]} currentIndex={-1} onSelect={vi.fn()} />);
        expect(container.firstChild).toBeNull();
    });
});

describe('TimelineRail look (D2b)', () => {
    it('uses the accent for the current dot and no superseded group roles', () => {
        const { container, rail } = setup(3);
        expect(rail.querySelector('.bg-accent.shadow-accent-glow')).toHaveClass('rounded-pill');
        expect(container.innerHTML).not.toMatch(/-group-(accent|glow|subtle|strong)/);
    });

    it('rings the hover in the accent once zoomed and glows the tooltip', () => {
        vi.useFakeTimers();
        const { rail } = setup();
        fireEvent.mouseMove(rail, { clientY: 230 });
        expect(rail.querySelector('.border-2')).toHaveClass('border-strong');
        expect(screen.getByText('#' + (42 - 21)).closest('.rounded-card')).toHaveClass('shadow-accent-glow');
        act(() => { vi.advanceTimersByTime(800); });
        expect(rail.querySelector('.border-2')).toHaveClass('border-accent');
        expect(rail.querySelector('.border-2')).toHaveClass('transition-[opacity,border-color]');
        expect(screen.getByText(blogs[21].title)).toHaveAttribute('lang', 'ja');
    });

    it('fills its column and is hidden from assistive technology', () => {
        const { rail } = setup();
        expect(rail).toHaveClass('inset-x-0');
        expect(rail).toHaveAttribute('aria-hidden', 'true');
    });

    it('shows a hover card with the date in the app language and the post number', () => {
        const { rail } = setup();
        fireEvent.mouseMove(rail, { clientY: 30 });
        expect(screen.getByText(formatBlogDate(new Date(blogs[0].published_at), 'en', 'medium'))).toBeInTheDocument();
        expect(screen.getByText('#42').closest('.rounded-card')).toHaveClass('shadow-accent-glow');
        expect(screen.getByText(blogs[0].title)).toHaveClass('font-reading');
    });
});
