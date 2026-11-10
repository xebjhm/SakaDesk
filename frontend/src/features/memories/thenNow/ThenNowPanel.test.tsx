import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchThenNowDay: vi.fn(), fetchThenNowFirstWeek: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { fetchThenNowDay, fetchThenNowFirstWeek } from '../api';
import { MEMBER_PATH } from '../__fixtures__/memories';
import { ThenNowPanel } from './ThenNowPanel';
import { thenNowDay, thenNowFirstWeek } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('ja'); });
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    vi.mocked(fetchThenNowDay).mockReset().mockResolvedValue(thenNowDay());
    vi.mocked(fetchThenNowFirstWeek).mockReset().mockResolvedValue(thenNowFirstWeek());
});

describe('ThenNowPanel', () => {
    it('loads the day pair for the date and the first week for the person', async () => {
        render(<ThenNowPanel service="hinatazaka46" date="2024-09-14" member={MEMBER_PATH} />);
        expect(await screen.findAllByTestId('then-now-side')).toHaveLength(2);
        expect(vi.mocked(fetchThenNowDay).mock.calls[0]?.slice(0, 2)).toEqual(['hinatazaka46', { date: '2024-09-14', member: MEMBER_PATH }]);
        expect(vi.mocked(fetchThenNowFirstWeek).mock.calls[0]?.slice(0, 2)).toEqual(['hinatazaka46', MEMBER_PATH]);
        expect(screen.getByRole('button', { name: 'あの日と今日' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('then-now-gap')).toHaveTextContent('2年');
    });

    it('switches to 初見と今 with labelled rows, and logs the mode', async () => {
        render(<ThenNowPanel service="hinatazaka46" date="2024-09-14" member={MEMBER_PATH} />);
        await userEvent.click(await screen.findByRole('button', { name: '初見と今' }));
        expect(screen.getByRole('button', { name: '初見と今' })).toHaveAttribute('aria-pressed', 'true');
        const rows = screen.getAllByTestId('then-now-row');
        expect(rows).toHaveLength(2);
        expect(within(rows[0]).getByText('写真')).toBeInTheDocument();
        expect(within(rows[1]).getByText('おはよう')).toBeInTheDocument();
        expect(within(rows[1]).getAllByTestId('then-now-side')).toHaveLength(2);
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'then_now_mode', outcome: 'on' });
        await userEvent.click(screen.getByRole('button', { name: 'あの日と今日' }));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'then_now_mode', outcome: 'off' });
    });

    it('hides a mode whose payload is null', async () => {
        vi.mocked(fetchThenNowDay).mockResolvedValue(null);
        render(<ThenNowPanel service="hinatazaka46" date="2024-09-14" member={MEMBER_PATH} />);
        expect(await screen.findByRole('button', { name: '初見と今' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByRole('button', { name: 'あの日と今日' })).toBeNull();
        expect(screen.getAllByTestId('then-now-row')).toHaveLength(2);
    });

    it('without a date asks only for the first week; without a person only for the day', async () => {
        const { unmount } = render(<ThenNowPanel service="hinatazaka46" member={MEMBER_PATH} />);
        expect(await screen.findByRole('button', { name: '初見と今' })).toBeInTheDocument();
        expect(vi.mocked(fetchThenNowDay)).not.toHaveBeenCalled();
        unmount();
        vi.mocked(fetchThenNowFirstWeek).mockClear();
        render(<ThenNowPanel service="hinatazaka46" date="2024-09-14" />);
        expect(await screen.findByRole('button', { name: 'あの日と今日' })).toBeInTheDocument();
        expect(vi.mocked(fetchThenNowFirstWeek)).not.toHaveBeenCalled();
        expect(vi.mocked(fetchThenNowDay).mock.lastCall?.[1]).toEqual({ date: '2024-09-14', member: undefined });
    });

    it('says so gently when neither mode has a pair', async () => {
        vi.mocked(fetchThenNowDay).mockResolvedValue(null);
        vi.mocked(fetchThenNowFirstWeek).mockResolvedValue(null);
        render(<ThenNowPanel service="hinatazaka46" date="2024-09-14" member={MEMBER_PATH} />);
        expect(await screen.findByText('ならべられる日は、まだありません。')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'あの日と今日' })).toBeNull();
        expect(screen.queryByText(/\d/)).toBeNull();
    });

    it('logs its loads as then_now', async () => {
        render(<ThenNowPanel service="hinatazaka46" date="2024-09-14" member={MEMBER_PATH} />);
        await screen.findAllByTestId('then-now-side');
        await waitFor(() => expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_load', expect.objectContaining({ target: 'then_now', outcome: 'ok' })));
    });
});
