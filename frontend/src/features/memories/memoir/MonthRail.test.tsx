import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import i18n from '../../../i18n';
import type { TimelineMonthCount } from '../types';
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

    it('zooms around the pointer after a dwell, which changes the mapping', () => {
        vi.useFakeTimers();
        // 60 months so the magnified window is narrower than the rail
        const many = Array.from({ length: 60 }, (_, i) => ({ month: `20${20 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, count: 1 + i }));
        const onSelect = vi.fn();
        render(<MonthRail months={many} index={59} onSelect={onSelect} label={(m) => m} />);
        const rail = screen.getByRole('slider');
        const width = 2 * RAIL_PADDING + 59 * 10;
        rail.getBoundingClientRect = () =>
            ({ top: 0, left: 0, right: width, bottom: 96, width, height: 96, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
        const at = (i: number) => RAIL_PADDING + i * 10;
        const lens = screen.getByTestId('month-rail-lens');
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
});
