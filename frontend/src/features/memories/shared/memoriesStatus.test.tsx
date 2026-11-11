import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
import i18n from '../../../i18n';
import { MemoriesStatus } from './memoriesStatus';
import type { MemoriesQuery } from './useMemoriesQuery';

beforeAll(async () => { await i18n.changeLanguage('ja'); });
beforeEach(() => { vi.mocked(clientLog).mockClear(); });
afterEach(() => { vi.useRealTimers(); });

const query = (over: Partial<MemoriesQuery<unknown>> = {}): MemoriesQuery<unknown> => ({
    status: 'loading', data: null, failure: null, stale: false, polling: false, retry: vi.fn(), ...over,
});

const uiWait = () => vi.mocked(clientLog).mock.calls.filter((c) => c[0] === 'ui_wait');

describe('MemoriesStatus', () => {
    it('stages the wait: nothing at 199 ms, the spinner at 200, the slow copy at 3000, the explanation and a bar at 10000', () => {
        vi.useFakeTimers();
        render(<MemoriesStatus query={query()} view="album" />);
        act(() => { vi.advanceTimersByTime(199); });
        expect(screen.getByRole('status')).toHaveAttribute('data-stage', 'hidden');
        expect(screen.queryByText('読み込み中…')).toBeNull();
        act(() => { vi.advanceTimersByTime(1); });
        expect(screen.getByRole('status')).toHaveAttribute('data-stage', 'shown');
        expect(screen.getByRole('status', { name: '読み込み中…' })).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(2799); });
        expect(screen.queryByText('思い出を準備しています…')).toBeNull();
        act(() => { vi.advanceTimersByTime(1); });
        expect(screen.getByText('思い出を準備しています…')).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(6999); });
        expect(screen.queryByRole('progressbar')).toBeNull();
        act(() => { vi.advanceTimersByTime(1); });
        expect(screen.getByText('初めて開くときや同期の直後は、アーカイブの整理に少し時間がかかります。')).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('logs ui_wait slow once, with the memories_ surface code', () => {
        vi.useFakeTimers();
        const { rerender } = render(<MemoriesStatus query={query()} view="album" />);
        act(() => { vi.advanceTimersByTime(3000); });
        rerender(<MemoriesStatus query={query()} view="album" />);
        act(() => { vi.advanceTimersByTime(1000); });
        const slow = uiWait().filter((c) => (c[1] as { phase: string }).phase === 'slow');
        expect(slow).toHaveLength(1);
        expect(slow[0][1]).toMatchObject({ surface: 'memories_album', phase: 'slow' });
    });

    it('an error shows the Memories error copy and Retry, which calls query.retry', async () => {
        const q = query({ status: 'error', failure: 'error' });
        render(<MemoriesStatus query={q} view="favorites" />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('読み込めませんでした');
        expect(alert).not.toHaveTextContent('いつもより時間がかかっています');
        await userEvent.click(screen.getByRole('button', { name: 'もう一度' }));
        expect(q.retry).toHaveBeenCalledTimes(1);
    });

    it('a timeout shows its own copy, its hint and Retry, and never the error copy', async () => {
        const q = query({ status: 'error', failure: 'timeout' });
        render(<MemoriesStatus query={q} view="hub" />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveAttribute('data-kind', 'timeout');
        expect(alert).toHaveTextContent('いつもより時間がかかっています');
        expect(alert).toHaveTextContent('準備はまだ続いているかもしれません。もう一度お試しください。');
        expect(alert).not.toHaveTextContent('読み込めませんでした');
        await userEvent.click(screen.getByRole('button', { name: 'もう一度' }));
        expect(q.retry).toHaveBeenCalledTimes(1);
    });

    it('renders nothing for a ready query', () => {
        const { container } = render(<MemoriesStatus query={query({ status: 'ready', data: { items: [] } })} view="album" />);
        expect(container).toBeEmptyDOMElement();
    });

    it('takes caller hints and the inline variant', () => {
        vi.useFakeTimers();
        render(<MemoriesStatus query={query()} view="hub" variant="inline" slowHint="まだ集めています 🌸" />);
        act(() => { vi.advanceTimersByTime(3000); });
        expect(screen.getByText('まだ集めています 🌸')).toBeInTheDocument();
        expect(screen.getByRole('status').className).toMatch(/flex-row/);
    });
});
