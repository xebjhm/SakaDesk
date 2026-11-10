import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { buildMonthGrid } from '../../../core/calendar/monthGrid';
import { DayCell } from './DayCell';
import { calendarDay, cellPhoto } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('en'); });

const SEPT = buildMonthGrid(2024, 8);
const cellOf = (dateStr: string) => SEPT.find((c) => c.dateStr === dateStr)!;

describe('DayCell', () => {
    it('draws the day photo through the thumbnail route, lazily', () => {
        render(<DayCell cell={cellOf('2024-09-14')} data={calendarDay('2024-09-14', 2, cellPhoto(41, '2024-09-14'))} onOpen={vi.fn()} />);
        const img = screen.getByRole('button').querySelector('img')!;
        expect(img.getAttribute('src')).toMatch(/^\/api\/content\/thumb\/hinatazaka46\/.+\/41\.jpg\?w=\d+$/);
        expect(img).toHaveAttribute('loading', 'lazy');
    });

    it('caps the member dots at five and prints no digit but the date', () => {
        render(<DayCell cell={cellOf('2024-09-14')} data={calendarDay('2024-09-14', 7)} onOpen={vi.fn()} />);
        const button = screen.getByRole('button');
        expect(screen.getAllByTestId('calendar-dot')).toHaveLength(5);
        expect(button.textContent).toBe('14');
        // The count lives only in the accessible name.
        expect(button).toHaveAccessibleName(/7 members/);
    });

    it('draws one dot per member up to five', () => {
        render(<DayCell cell={cellOf('2024-09-14')} data={calendarDay('2024-09-14', 2)} onOpen={vi.fn()} />);
        expect(screen.getAllByTestId('calendar-dot')).toHaveLength(2);
    });

    it('names the holiday in Japanese, tones it red and puts it in the accessible name', () => {
        render(<DayCell cell={cellOf('2024-09-16')} data={calendarDay('2024-09-16', 1)} onOpen={vi.fn()} />);
        const button = screen.getByRole('button');
        expect(button).toHaveAccessibleName(/敬老の日/);
        expect(screen.getByText('16')).toHaveClass('text-calendar-holiday');
        expect(button.querySelector('[lang="ja"]')).toHaveTextContent('敬老の日');
    });

    it('tones a Saturday blue', () => {
        render(<DayCell cell={cellOf('2024-09-14')} data={calendarDay('2024-09-14', 1)} onOpen={vi.fn()} />);
        expect(screen.getByText('14')).toHaveClass('text-calendar-saturday');
    });

    it('opens its day on click', async () => {
        const onOpen = vi.fn();
        render(<DayCell cell={cellOf('2024-09-14')} data={calendarDay('2024-09-14', 1)} onOpen={onOpen} />);
        await userEvent.click(screen.getByRole('button'));
        expect(onOpen).toHaveBeenCalledWith('2024-09-14');
    });

    it('leaves a day without data grey and not clickable', () => {
        render(<DayCell cell={cellOf('2024-09-17')} data={undefined} onOpen={vi.fn()} />);
        expect(screen.queryByRole('button')).toBeNull();
        const cell = screen.getByTestId('calendar-cell-2024-09-17');
        expect(cell).toHaveClass('bg-sunken');
        expect(screen.queryByTestId('calendar-dot')).toBeNull();
        expect(cell.textContent).toBe('17');
    });

    it('fades an out-of-month cell', () => {
        // September 2024 starts on a Sunday: the last cells are October's.
        const outside = SEPT[41];
        expect(outside.inMonth).toBe(false);
        render(<DayCell cell={outside} data={undefined} onOpen={vi.fn()} />);
        expect(screen.getByTestId(`calendar-cell-${outside.dateStr}`)).toHaveAttribute('data-outside');
        expect(screen.getByTestId(`calendar-cell-${outside.dateStr}`)).toHaveClass('opacity-60');
    });
});
