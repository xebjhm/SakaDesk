import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { CalendarModal, type DateCount } from './CalendarModal';
import { resetDialogStack } from '../../design/dialog/dialogStack';
import { clientLog } from '../../utils/clientLog';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

// Japanese-style calendar (R-h): Sunday start, Sundays and 祝日 red, Saturdays blue, holiday
// names in Japanese, and a year / month picker behind the month title.
beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    resetDialogStack();
    vi.mocked(clientLog).mockClear();
    vi.useFakeTimers({ toFake: ['Date'] });
    // November 2026: 1st is a Sunday, the 3rd is Culture Day and the 23rd Labour Thanksgiving Day.
    vi.setSystemTime(new Date(2026, 10, 10, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

const open = (dates: DateCount[] = [], onClose = vi.fn(), onSelectDate = vi.fn()) =>
    render(<CalendarModal isOpen onClose={onClose} dates={dates} onSelectDate={onSelectDate} />);

/** The in-month day cell for a day number (out-of-month cells carry data-outside). */
const day = (n: number) =>
    screen.getAllByRole('button').find(b => b.hasAttribute('data-day') && !b.hasAttribute('data-outside') && b.getAttribute('data-day') === String(n))!;

describe('CalendarModal, Japanese style', () => {
    it('starts the week on Sunday and colours the Sunday and Saturday headers', () => {
        open();
        const headers = screen.getAllByTestId('calendar-weekday');
        expect(headers.map(h => h.textContent)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
        expect(headers[0]).toHaveClass('text-calendar-holiday');
        expect(headers[6]).toHaveClass('text-calendar-saturday');
        for (const h of headers.slice(1, 6)) {
            expect(h).toHaveClass('text-muted');
            expect(h).not.toHaveClass('text-calendar-holiday', 'text-calendar-saturday');
        }
    });

    it('draws Sundays and holidays red and Saturdays blue, other days neutral', () => {
        open([{ date: '2026-11-08', count: 2 }, { date: '2026-11-14', count: 1 }]);
        expect(day(1)).toHaveClass('text-calendar-holiday'); // Sunday
        expect(day(8)).toHaveClass('text-calendar-holiday'); // Sunday with messages
        expect(day(3)).toHaveClass('text-calendar-holiday'); // 文化の日 (Tuesday)
        expect(day(23)).toHaveClass('text-calendar-holiday'); // 勤労感謝の日 (Monday)
        expect(day(7)).toHaveClass('text-calendar-saturday');
        expect(day(14)).toHaveClass('text-calendar-saturday'); // Saturday with messages
        for (const n of [2, 4, 10]) {
            expect(day(n)).not.toHaveClass('text-calendar-holiday');
            expect(day(n)).not.toHaveClass('text-calendar-saturday');
        }
        expect(document.querySelector('.text-sunday')).toBeNull();
    });

    it('keeps out-of-month days muted but readable (text-muted at 80 %, ≥ 3:1)', () => {
        open();
        const outside = screen.getAllByRole('button').filter(b => b.hasAttribute('data-outside'));
        expect(outside.length).toBeGreaterThan(0);
        for (const b of outside) {
            expect(b).toHaveClass('text-muted', 'opacity-80');
            expect(b).not.toHaveClass('opacity-30', 'text-calendar-holiday', 'text-calendar-saturday');
        }
    });

    it('names every day through the shared formatter, not one toLocaleDateString per cell', () => {
        const slow = vi.spyOn(Date.prototype, 'toLocaleDateString');
        open();
        expect(day(4)).toHaveAccessibleName('Wednesday, November 4, 2026');
        expect(slow).not.toHaveBeenCalled();
        slow.mockRestore();
    });

    it('names the holiday in Japanese in the tooltip and the accessible name', () => {
        open([{ date: '2026-11-23', count: 4 }]);
        const culture = day(3);
        expect(culture).toHaveAccessibleName('Tuesday, November 3, 2026, 文化の日');
        const tip = within(culture).getByRole('tooltip', { hidden: true });
        expect(tip).toHaveAttribute('aria-hidden', 'true');
        expect(within(tip).getByText('文化の日')).toHaveAttribute('lang', 'ja');
        expect(within(culture).getByText('文化の日', { selector: '.sr-only [lang="ja"]' })).toBeInTheDocument();
        // A holiday with messages lists both lines; the count is the accessible description.
        const labour = day(23);
        expect(labour).toHaveAccessibleName('Monday, November 23, 2026, 勤労感謝の日');
        expect(labour).toHaveAccessibleDescription('4 items');
        expect(within(labour).getByRole('tooltip', { hidden: true })).toHaveTextContent('勤労感謝の日4 items');
        // The tooltip shows on hover and keyboard focus, in the app's dark tooltip style.
        expect(tip).toHaveClass('bg-toast', 'text-viewer', 'group-hover/day:opacity-100', 'group-focus-visible/day:opacity-100');
        // An ordinary day has no tooltip.
        expect(within(day(4)).queryByRole('tooltip', { hidden: true })).toBeNull();
    });

    it('opens the tooltip below the cell in the first row so it never covers the weekday header', () => {
        open();
        const firstRow = within(day(3)).getByRole('tooltip', { hidden: true }); // 文化の日, row 1
        expect(firstRow).toHaveClass('top-full', 'mt-1');
        expect(firstRow).not.toHaveClass('bottom-full');
        const later = within(day(23)).getByRole('tooltip', { hidden: true }); // 勤労感謝の日, row 4
        expect(later).toHaveClass('bottom-full', 'mb-1');
        expect(later).not.toHaveClass('top-full');
    });

    it.each([
        ['ja', '2026年11月'],
        ['zh-TW', '2026年11月'],
        ['zh-CN', '2026年11月'],
        ['yue', '2026年11月'],
        ['en', 'November 2026'],
    ])('titles the month numerically in CJK locales (%s → %s)', async (lng, expected) => {
        await i18n.changeLanguage(lng);
        try {
            open();
            const title = screen.getByRole('button', { expanded: false, name: new RegExp(`^${expected}`) });
            expect(title.querySelector('span')).toHaveTextContent(new RegExp(`^${expected}$`));
        } finally {
            cleanup(); // unmount first, so switching back is not a stray update
            await i18n.changeLanguage('en');
        }
    });

    describe('year / month picker', () => {
        const dates = [
            { date: '2024-06-15', count: 5 },
            { date: '2026-11-08', count: 2 },
        ];

        it('opens from the month title with years from the first message year to this year', async () => {
            const user = userEvent.setup();
            open(dates);
            const title = screen.getByRole('button', { name: /November 2026/ });
            expect(title).toHaveAttribute('aria-expanded', 'false');
            await user.click(title);

            expect(screen.getByRole('button', { name: /November 2026/ })).toHaveAttribute('aria-expanded', 'true');
            const years = within(screen.getByRole('group', { name: 'Year' })).getAllByRole('button');
            expect(years.map(y => y.textContent)).toEqual(['2024', '2025', '2026']);
            expect(years[2]).toHaveAttribute('aria-pressed', 'true');
            // Years with messages are first-class; a year without is dimmed but still selectable.
            expect(years[0]).toHaveClass('text-primary');
            expect(years[1]).toHaveClass('text-muted');
            expect(years[1]).toBeEnabled();
            // The day grid is replaced by a 12-month grid; the shown month is the selected one.
            expect(screen.queryAllByTestId('calendar-weekday')).toHaveLength(0);
            const months = within(screen.getByRole('group', { name: 'Month' })).getAllByRole('button');
            expect(months).toHaveLength(12);
            expect(months[10]).toHaveAttribute('aria-pressed', 'true');
            expect(clientLog).toHaveBeenCalledWith('calendar_picker', { phase: 'open', count: 3 });
        });

        it('dims months without messages but lets them be picked, then shows that month', async () => {
            const user = userEvent.setup();
            open(dates);
            await user.click(screen.getByRole('button', { name: /November 2026/ }));
            await user.click(within(screen.getByRole('group', { name: 'Year' })).getByRole('button', { name: '2024' }));

            const monthGroup = screen.getByRole('group', { name: 'Month' });
            const june = within(monthGroup).getByRole('button', { name: 'June' });
            const january = within(monthGroup).getByRole('button', { name: 'January, No messages' });
            expect(june).toHaveClass('text-primary');
            expect(january).toHaveClass('text-muted');
            expect(january).toBeEnabled();

            await user.click(january);
            expect(screen.getByRole('button', { name: /January 2024/ })).toHaveAttribute('aria-expanded', 'false');
            expect(screen.getAllByTestId('calendar-weekday')).toHaveLength(7);
            expect(clientLog).toHaveBeenCalledWith('calendar_picker', { phase: 'select', has_target: false });

            await user.click(screen.getByRole('button', { name: /January 2024/ }));
            await user.click(within(screen.getByRole('group', { name: 'Month' })).getByRole('button', { name: 'June' }));
            expect(screen.getByRole('button', { name: /June 2024/ })).toBeInTheDocument();
            expect(day(15)).toBeEnabled();
            expect(clientLog).toHaveBeenCalledWith('calendar_picker', { phase: 'select', has_target: true });
        });

        it('scrolls the selected year into view and focuses the shown month when it opens', async () => {
            const user = userEvent.setup();
            const scrolled: Element[] = [];
            Element.prototype.scrollIntoView = vi.fn(function (this: Element) { scrolled.push(this); });
            open([{ date: '2010-01-05', count: 1 }, ...dates]);
            await user.click(screen.getByRole('button', { name: /November 2026/ }));
            const selectedYear = within(screen.getByRole('group', { name: 'Year' })).getByRole('button', { name: '2026' });
            expect(selectedYear).toHaveAttribute('aria-pressed', 'true');
            expect(scrolled).toContain(selectedYear);
            const shownMonth = within(screen.getByRole('group', { name: 'Month' })).getByRole('button', { name: 'November' });
            expect(shownMonth).toHaveFocus();
        });

        it('opened while the dates load, keeps focus on the title, then moves it into the picker', async () => {
            const user = userEvent.setup();
            let resolve!: (r: unknown) => void;
            vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { resolve = r; })));
            try {
                render(<CalendarModal isOpen onClose={vi.fn()} conversationPath="hinatazaka46/messages/a" onSelectDate={vi.fn()} />);
                const title = screen.getByRole('button', { name: /November 2026/ });
                await user.click(title);
                expect(title).toHaveAttribute('aria-expanded', 'true');
                expect(screen.queryByRole('group', { name: 'Month' })).toBeNull();
                expect(title).toHaveFocus();
                resolve({ ok: true, json: async () => ({ dates: dates }) });
                const shownMonth = await within(await screen.findByRole('group', { name: 'Month' })).findByRole('button', { name: 'November' });
                await waitFor(() => expect(shownMonth).toHaveFocus());
            } finally {
                vi.unstubAllGlobals();
            }
        });

        it('Escape returns to the day grid without closing the dialog', async () => {
            const user = userEvent.setup();
            const onClose = vi.fn();
            open(dates, onClose);
            await user.click(screen.getByRole('button', { name: /November 2026/ }));
            await user.keyboard('{Escape}');
            expect(onClose).not.toHaveBeenCalled();
            expect(screen.getAllByTestId('calendar-weekday')).toHaveLength(7);
            expect(screen.getByRole('button', { name: /November 2026/ })).toHaveFocus();
            expect(clientLog).toHaveBeenCalledWith('calendar_picker', { phase: 'back', reason: 'escape' });
            // A second Escape closes the dialog as usual.
            await user.keyboard('{Escape}');
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('the back button returns to the day grid on the same month', async () => {
            const user = userEvent.setup();
            open(dates);
            await user.click(screen.getByRole('button', { name: /November 2026/ }));
            await user.click(within(screen.getByRole('group', { name: 'Year' })).getByRole('button', { name: '2024' }));
            await user.click(screen.getByRole('button', { name: 'Back to the days' }));
            expect(screen.getByRole('button', { name: /November 2026/ })).toBeInTheDocument();
            expect(screen.getAllByTestId('calendar-weekday')).toHaveLength(7);
            expect(clientLog).toHaveBeenCalledWith('calendar_picker', { phase: 'back', reason: 'button' });
        });

        it('without any message dates offers the last ten years', async () => {
            const user = userEvent.setup();
            open([]);
            await user.click(screen.getByRole('button', { name: /November 2026/ }));
            const years = within(screen.getByRole('group', { name: 'Year' })).getAllByRole('button');
            expect(years[0]).toHaveTextContent('2017');
            expect(years[years.length - 1]).toHaveTextContent('2026');
        });

        it('localises the title and the picker labels', async () => {
            const user = userEvent.setup();
            await i18n.changeLanguage('ja');
            try {
                open(dates);
                await user.click(screen.getByRole('button', { expanded: false, name: /2026年11月/ }));
                expect(within(screen.getByRole('group', { name: '年' })).getByRole('button', { name: '2024年' })).toBeInTheDocument();
                expect(within(screen.getByRole('group', { name: '月' })).getAllByRole('button')[0]).toHaveTextContent('1月');
            } finally {
                await i18n.changeLanguage('en');
            }
        });
    });
});
