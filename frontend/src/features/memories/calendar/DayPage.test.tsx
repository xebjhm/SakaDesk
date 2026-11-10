import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchDay: vi.fn() };
});
import { fetchDay } from '../api';
import { DayPage } from './DayPage';

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    vi.mocked(fetchDay).mockReset().mockResolvedValue({ date: '2024-09-14', members: [], messages: [] } as never);
});

describe('DayPage', () => {
    it('shows the core day view for the route date, titled with its JST date', async () => {
        render(<DayPage service="hinatazaka46" route={{ page: 'day', date: '2024-09-14', from: 'calendar' }} go={vi.fn()} />);
        expect(screen.getByRole('heading', { level: 1, name: 'Sep 14, 2024' })).toBeInTheDocument();
        expect(screen.getByTestId('day-view')).toBeInTheDocument();
        expect(fetchDay).toHaveBeenCalledWith('hinatazaka46', expect.objectContaining({ date: '2024-09-14' }), expect.any(AbortSignal));
    });

    it('back returns to the calendar month it came from', async () => {
        const go = vi.fn();
        render(<DayPage service="hinatazaka46" route={{ page: 'day', date: '2024-09-14', from: 'calendar' }} go={go} />);
        await userEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(go).toHaveBeenCalledWith({ page: 'calendar', month: '2024-09' });
    });

    it('back goes home when the day was not opened from the calendar', async () => {
        const go = vi.fn();
        render(<DayPage service="hinatazaka46" route={{ page: 'day', date: '2024-09-14' }} go={go} />);
        await userEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(go).toHaveBeenCalledWith({ page: 'home' });
    });
});
