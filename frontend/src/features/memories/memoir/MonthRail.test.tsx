import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import i18n from '../../../i18n';
import type { TimelineMonthCount } from '../types';
import { fisheyePosition } from '../../blogs/components/fisheye';
import { MonthRail, RAIL_PADDING } from './MonthRail';

beforeAll(async () => { await i18n.changeLanguage('ja'); });
afterEach(() => vi.useRealTimers());

/** 2023-11 … 2024-12 (14 months, oldest first); 2024-02 and 2024-03 are empty. */
const MONTHS: TimelineMonthCount[] = Array.from({ length: 14 }, (_, i) => {
    const y = 2023 + Math.floor((10 + i) / 12);
    const m = ((10 + i) % 12) + 1;
    const month = `${y}-${String(m).padStart(2, '0')}`;
    return { month, count: month === '2024-02' || month === '2024-03' ? 0 : 10 + i };
});
const LAST = MONTHS.length - 1;
const WIDTH = 2 * RAIL_PADDING + 13 * 40; // 40 px per month step

function setup(index = LAST) {
    const onSelect = vi.fn();
    const view = render(
        <MonthRail months={MONTHS} index={index} onSelect={onSelect} label={(month) => `${month} の月`} />,
    );
    const rail = screen.getByRole('slider');
    rail.getBoundingClientRect = () =>
        ({ top: 0, left: 0, right: WIDTH, bottom: 96, width: WIDTH, height: 96, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    return { ...view, rail, onSelect };
}

const xOf = (i: number) => RAIL_PADDING + i * 40;

describe('MonthRail', () => {
    it('is a slider named for picking a month, reading the month label', () => {
        const { rail } = setup(5);
        expect(rail).toHaveAccessibleName('月をえらぶ');
        expect(rail).toHaveAttribute('aria-valuetext', `${MONTHS[5].month} の月`);
        expect(rail).toHaveAttribute('aria-valuenow', '5');
        expect(rail).toHaveAttribute('aria-valuemin', '0');
        expect(rail).toHaveAttribute('aria-valuemax', String(LAST));
    });

    it('steps older with ← and newer with →, and stops at the ends', () => {
        const { rail, onSelect, rerender } = setup(5);
        fireEvent.keyDown(rail, { key: 'ArrowLeft' });
        expect(onSelect).toHaveBeenLastCalledWith(4);
        fireEvent.keyDown(rail, { key: 'ArrowRight' });
        expect(onSelect).toHaveBeenLastCalledWith(6);
        fireEvent.keyDown(rail, { key: 'Home' });
        expect(onSelect).toHaveBeenLastCalledWith(0);
        fireEvent.keyDown(rail, { key: 'End' });
        expect(onSelect).toHaveBeenLastCalledWith(LAST);
        onSelect.mockClear();
        rerender(<MonthRail months={MONTHS} index={LAST} onSelect={onSelect} label={(m) => m} />);
        fireEvent.keyDown(rail, { key: 'ArrowRight' });
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('has older / newer buttons', () => {
        const { onSelect } = setup(5);
        fireEvent.click(screen.getByRole('button', { name: '前の月' }));
        expect(onSelect).toHaveBeenLastCalledWith(4);
        fireEvent.click(screen.getByRole('button', { name: '次の月' }));
        expect(onSelect).toHaveBeenLastCalledWith(6);
    });

    it('steps one month per wheel notch: down / right is newer, up / left older', () => {
        const { rail, onSelect } = setup(5);
        fireEvent.wheel(rail, { deltaY: 100 });
        expect(onSelect).toHaveBeenLastCalledWith(6);
        fireEvent.wheel(rail, { deltaY: -100 });
        expect(onSelect).toHaveBeenLastCalledWith(4);
        fireEvent.wheel(rail, { deltaX: 100 });
        expect(onSelect).toHaveBeenLastCalledWith(6);
        // small trackpad deltas add up before a step
        onSelect.mockClear();
        fireEvent.wheel(rail, { deltaY: 10 });
        expect(onSelect).not.toHaveBeenCalled();
        for (let i = 0; i < 4; i += 1) fireEvent.wheel(rail, { deltaY: 10 });
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('scrubs with a pointer drag, selecting each month once, and stops on release', () => {
        const { rail, onSelect } = setup(LAST);
        fireEvent.pointerDown(rail, { button: 0, clientX: xOf(2), pointerId: 1 });
        expect(onSelect).toHaveBeenLastCalledWith(2);
        fireEvent.pointerMove(rail, { clientX: xOf(2) + 5, pointerId: 1 });
        expect(onSelect).toHaveBeenCalledTimes(1);
        fireEvent.pointerMove(rail, { clientX: xOf(6), pointerId: 1 });
        expect(onSelect).toHaveBeenLastCalledWith(6);
        fireEvent.pointerMove(rail, { clientX: WIDTH + 50, pointerId: 1 });
        expect(onSelect).toHaveBeenLastCalledWith(LAST);
        fireEvent.pointerUp(rail, { clientX: WIDTH, pointerId: 1 });
        onSelect.mockClear();
        fireEvent.pointerMove(rail, { clientX: xOf(1), pointerId: 1 });
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('draws a bar per month with messages and a baseline tick for an empty month, never its number', () => {
        setup();
        expect(screen.getAllByTestId('month-rail-bar')).toHaveLength(12);
        expect(screen.getAllByTestId('month-rail-tick')).toHaveLength(2);
        const rail = screen.getByRole('slider');
        expect(rail.textContent).not.toMatch(/(?<!\d)0(?!\d)/);
        // the busiest month is the full height; the selected one is marked
        const bars = screen.getAllByTestId('month-rail-bar');
        expect(bars[bars.length - 1].style.height).toBe('100%');
        expect(bars[bars.length - 1]).toHaveAttribute('data-selected', 'true');
    });

    it('marks the first month of each year', () => {
        setup();
        expect(screen.getByText('2023')).toBeInTheDocument();
        expect(screen.getByText('2024')).toBeInTheDocument();
    });

    /** 60 months, 5 px apart (close enough to zoom). */
    function setupMany(index = 59) {
        const many = Array.from({ length: 60 }, (_, i) => ({
            month: `20${20 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, count: 1 + i,
        }));
        const onSelect = vi.fn();
        render(<MonthRail months={many} index={index} onSelect={onSelect} label={(m) => m} />);
        const rail = screen.getByRole('slider');
        const width = 2 * RAIL_PADDING + 59 * 5;
        rail.getBoundingClientRect = () =>
            ({ top: 0, left: 0, right: width, bottom: 96, width, height: 96, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
        const at = (i: number) => RAIL_PADDING + i * 5;
        return { rail, onSelect, at, lens: screen.getByTestId('month-rail-lens') };
    }

    it('zooms around the pointer after a dwell, which changes the mapping', () => {
        vi.useFakeTimers();
        const { rail, onSelect, at, lens } = setupMany();
        expect(lens).toHaveClass('opacity-0');
        fireEvent.pointerMove(rail, { clientX: at(30), pointerId: 1 });
        act(() => { vi.advanceTimersByTime(800); });
        expect(lens).toHaveClass('opacity-100');
        // unzoomed this is month 33; zoomed, months near 30 are spread apart
        fireEvent.pointerDown(rail, { button: 0, clientX: at(33), pointerId: 1 });
        expect(onSelect).toHaveBeenLastCalledWith(31);
        fireEvent.pointerUp(rail, { pointerId: 1 });
        fireEvent.pointerLeave(rail, { pointerId: 1 });
        expect(lens).toHaveClass('opacity-0');
    });

    it('zooms gently: the magnified months take about half the rail, the rest stays readable', () => {
        vi.useFakeTimers();
        const { rail, at } = setupMany();
        fireEvent.pointerMove(rail, { clientX: at(30), pointerId: 1 });
        act(() => { vi.advanceTimersByTime(800); });
        const lefts = screen.getAllByTestId('month-rail-bar').map((b) => b.style.left);
        const pos = (css: string) => Number(/\+ ([\d.e-]+) \*/.exec(css)?.[1]);
        const gaps = lefts.slice(1).map((l, i) => pos(l) - pos(lefts[i]));
        // no folds, no gap wider than the magnified step, no month squeezed to nothing
        for (const gap of gaps) {
            expect(gap).toBeGreaterThan(0.005);
            expect(gap).toBeLessThan(0.05);
        }
    });

    it('follows the pointer while zoomed', () => {
        vi.useFakeTimers();
        const { rail, at, lens } = setupMany();
        fireEvent.pointerMove(rail, { clientX: at(30), pointerId: 1 });
        act(() => { vi.advanceTimersByTime(800); });
        const before = lens.style.left;
        fireEvent.pointerMove(rail, { clientX: at(40), pointerId: 1 });
        expect(lens.style.left).not.toBe(before);
        expect(lens).toHaveClass('opacity-100');
    });

    it('does not zoom when the months are far enough apart to pick', () => {
        vi.useFakeTimers();
        const { rail } = setup(); // 40 px per month
        fireEvent.pointerMove(rail, { clientX: xOf(6), pointerId: 1 });
        act(() => { vi.advanceTimersByTime(2000); });
        expect(screen.getByTestId('month-rail-lens')).toHaveClass('opacity-0');
    });

    it('does not zoom in the middle of a drag', () => {
        vi.useFakeTimers();
        const { rail, at, lens } = setupMany();
        fireEvent.pointerDown(rail, { button: 0, clientX: at(30), pointerId: 1 });
        fireEvent.pointerMove(rail, { clientX: at(31), pointerId: 1 });
        act(() => { vi.advanceTimersByTime(2000); });
        expect(lens).toHaveClass('opacity-0');
        fireEvent.pointerUp(rail, { pointerId: 1 });
    });

    it('sizes the lens to the magnified months', () => {
        vi.useFakeTimers();
        const { rail, at, lens } = setupMany();
        fireEvent.pointerMove(rail, { clientX: at(30), pointerId: 1 });
        act(() => { vi.advanceTimersByTime(800); });
        // the month rail's shape: ±6 months, 2.5×, at most a quarter of the rail per side
        const shape = { magnifiedWindow: 6, magnification: 2.5, maxSpread: 0.25 };
        const lo = fisheyePosition(24, 60, 30, shape);
        const hi = fisheyePosition(36, 60, 30, shape);
        expect(hi - lo).toBeCloseTo(0.5);
        expect(lens.style.left).toBe(`calc(${RAIL_PADDING}px + ${lo} * (100% - ${2 * RAIL_PADDING}px))`);
        expect(lens.style.width).toBe(`calc(${hi - lo} * (100% - ${2 * RAIL_PADDING}px))`);
    });

    it('keeps the zoom centre still in the middle of a drag', () => {
        vi.useFakeTimers();
        const { rail, at, lens, onSelect } = setupMany();
        fireEvent.pointerMove(rail, { clientX: at(30), pointerId: 1 });
        act(() => { vi.advanceTimersByTime(800); });
        const before = lens.style.left;
        fireEvent.pointerDown(rail, { button: 0, clientX: at(30), pointerId: 1 });
        fireEvent.pointerMove(rail, { clientX: at(40), pointerId: 1 });
        expect(lens.style.left).toBe(before);
        // zoomed around 30: 10 px-months right of the centre is 4 months (2.5×)
        expect(onSelect).toHaveBeenLastCalledWith(34);
        fireEvent.pointerUp(rail, { pointerId: 1 });
    });

    it('forgets a wheel remainder after a pause or a turn', () => {
        vi.useFakeTimers();
        const { rail, onSelect } = setup(5);
        fireEvent.wheel(rail, { deltaY: 30 });
        fireEvent.wheel(rail, { deltaY: -30 }); // turned: starts again from -30
        expect(onSelect).not.toHaveBeenCalled();
        fireEvent.wheel(rail, { deltaY: -30 });
        expect(onSelect).toHaveBeenLastCalledWith(4);
        onSelect.mockClear();
        fireEvent.wheel(rail, { deltaY: 30 });
        act(() => { vi.advanceTimersByTime(300); });
        fireEvent.wheel(rail, { deltaY: 30 }); // the earlier 30 is forgotten
        expect(onSelect).not.toHaveBeenCalled();
    });
});
