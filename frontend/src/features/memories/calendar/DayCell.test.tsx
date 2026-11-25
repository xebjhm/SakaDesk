import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { installMediaTileHarness } from '../../../__tests__/mediaTileHarness';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { buildMonthGrid } from '../../../core/calendar/monthGrid';
import { DayCell } from './DayCell';
import { calendarDay, cellPhoto } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('en'); });
afterEach(() => { vi.unstubAllGlobals(); });

const SEPT = buildMonthGrid(2024, 8);
const cellOf = (dateStr: string) => SEPT.find((c) => c.dateStr === dateStr)!;

describe('DayCell', () => {
    it('draws the day photo through the thumbnail route at the drawn cell size', async () => {
        const h = installMediaTileHarness();
        render(<DayCell cell={cellOf('2024-09-14')} data={calendarDay('2024-09-14', 2, cellPhoto(41, '2024-09-14'))} px={300} onOpen={vi.fn()} />);
        expect(within(screen.getByRole('button')).getByTestId('memory-thumb')).toBeInTheDocument();
        await waitFor(() => expect(h.requested()).toHaveLength(1));
        expect(h.requested()[0]).toMatch(/^\/api\/content\/thumb\/hinatazaka46\/.+\/41\.jpg\?w=320$/);
    });

    it('draws a video-only day as a still with the video mark', () => {
        const clip = cellPhoto(42, '2024-09-14', { type: 'video', media_url: '/api/content/media/hinatazaka46/messages/r/video/42.mp4' });
        render(<DayCell cell={cellOf('2024-09-14')} data={calendarDay('2024-09-14', 1, clip)} onOpen={vi.fn()} />);
        // the shared tile (poster or film tile), never a <video>
        expect(screen.getByTestId('memory-thumb')).toBeInTheDocument();
        expect(screen.getByRole('button').querySelector('video')).toBeNull();
        expect(screen.getByTestId('calendar-video-mark')).toBeInTheDocument();
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
