import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TimelineRail } from './TimelineRail';
import type { BlogMeta } from '../../../types';

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
