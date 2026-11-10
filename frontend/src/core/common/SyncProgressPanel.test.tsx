// frontend/src/core/common/SyncProgressPanel.test.tsx
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { SyncProgressPanel } from './SyncProgressPanel';
import type { SyncProgress } from '../../features/messages/MessagesFeature';

beforeAll(async () => { await i18n.changeLanguage('en'); });

const RUNNING: SyncProgress = {
    state: 'running', phase: 'syncing', phase_number: 2, completed: 5, total: 20,
    elapsed_seconds: 30, eta_seconds: 90, speed: 2.5, speed_unit: 'members', detail: 'Fixture detail',
};

describe('SyncProgressPanel', () => {
    it('shows the count, the percent and a named progress bar filled with the expressive progress', () => {
        render(<SyncProgressPanel progress={RUNNING} />);
        expect(screen.getByText('5 / 20')).toBeInTheDocument();
        expect(screen.getByText('25%')).toBeInTheDocument();
        const bar = screen.getByRole('progressbar', { name: 'Sync progress' });
        expect(bar).toHaveAttribute('aria-valuenow', '25');
        const fill = bar.firstElementChild as HTMLElement;
        expect(fill).toHaveClass('bg-expressive-progress');
        expect(fill.style.width).toBe('25%');
    });

    it('shows the detail row only while running', () => {
        const { rerender } = render(<SyncProgressPanel progress={RUNNING} />);
        expect(screen.getByText('Fixture detail').closest('div')).toHaveClass('bg-accent-subtle');
        rerender(<SyncProgressPanel progress={{ ...RUNNING, state: 'complete', phase: 'complete' }} />);
        expect(screen.queryByText('Fixture detail')).toBeNull();
    });

    it('the media phase row is a semantic warning', () => {
        render(<SyncProgressPanel progress={{ ...RUNNING, phase: 'downloading', phase_number: 3 }} />);
        const row = screen.getByText('Downloading media... Please do not close the app.').closest('div') as HTMLElement;
        expect(row).toHaveClass('bg-semantic-warning-subtle', 'text-semantic-warning');
    });

    it('marks done, current and pending phase steps', () => {
        render(<SyncProgressPanel progress={RUNNING} />);
        const dot = (label: string) => screen.getByText(label).closest('li')!.querySelector('span[aria-hidden="true"]');
        expect(dot('Scan')).toHaveClass('bg-status-success');
        expect(screen.getByText('Syncing...').closest('li')).toHaveAttribute('aria-current', 'step');
        expect(dot('Syncing...')).toHaveClass('bg-accent', 'ring-4', 'ring-accent-subtle');
        expect(screen.getByText('Syncing...')).toHaveClass('text-accent-strong');
        expect(dot('Download')).toHaveClass('bg-control-off');
    });

    it('does not rely on colour alone: a check on done steps and a status string on each', () => {
        render(<SyncProgressPanel progress={RUNNING} />);
        const li = (label: string) => screen.getByText(label).closest('li')!;
        expect(li('Scan').querySelector('svg')).not.toBeNull();
        expect(li('Scan').querySelector('.sr-only')).toHaveTextContent('Done');
        expect(li('Syncing...').querySelector('.sr-only')).toHaveTextContent('Current step');
        expect(li('Syncing...').querySelector('svg')).toBeNull();
        expect(li('Download').querySelector('.sr-only')).toHaveTextContent('Pending');
    });

    it('stacks each stat as a number over its unit so a long unit cannot make a tile taller', () => {
        render(<SyncProgressPanel progress={{ ...RUNNING, speed: 12.345, speed_unit: 'ファイル' }} />);
        const unit = screen.getByText('ファイル/s');
        expect(unit).toHaveClass('text-caption', 'text-secondary');
        const value = screen.getByText('12.3');
        expect(value).toHaveClass('text-title');
        expect(value.parentElement).toBe(unit.parentElement);
    });

    it('exposes the count as the progressbar value text', () => {
        render(<SyncProgressPanel progress={RUNNING} />);
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '5 / 20');
    });

    it('a finished sync with a zero total still shows 0% (only a running or queued sync scans)', () => {
        render(<SyncProgressPanel progress={{ ...RUNNING, state: 'complete', phase: 'complete', total: 0, completed: 0 }} />);
        expect(screen.getByText('0%')).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    });

    it('discovering counts as the scan step being current', () => {
        render(<SyncProgressPanel progress={{ ...RUNNING, phase: 'discovering' }} />);
        expect(screen.getByText('Scan').closest('li')).toHaveAttribute('aria-current', 'step');
    });

    // S2 (spec 2026-11-10): honest progress.
    it('shows the run elapsed, which does not reset per phase', () => {
        render(<SyncProgressPanel progress={{ ...RUNNING, elapsed_seconds: 5, run_elapsed_seconds: 125 }} />);
        expect(screen.getByText('02:05')).toBeInTheDocument();
    });

    it('shows a dash when the phase cannot be estimated and "Estimating…" while warming up', () => {
        const { rerender } = render(<SyncProgressPanel progress={{ ...RUNNING, eta_seconds: null, eta_reason: 'not_estimable' }} />);
        expect(screen.getByText('—')).toBeInTheDocument();
        rerender(<SyncProgressPanel progress={{ ...RUNNING, phase: 'downloading', phase_number: 3, eta_seconds: null, eta_reason: 'warming_up' }} />);
        expect(screen.getByText('Estimating…')).toBeInTheDocument();
    });

    it('counts failed downloads next to the media warning', () => {
        render(<SyncProgressPanel progress={{ ...RUNNING, phase: 'downloading', phase_number: 3, failed: 2 }} />);
        expect(screen.getByText(/· 2 failed/)).toBeInTheDocument();
    });

    it('a queued sync shows its place in line in the detail row', () => {
        render(<SyncProgressPanel progress={{ state: 'queued', phase: 'queued', queue_position: 2 }} />);
        expect(screen.getByText('Waiting for another sync to finish (#2 in line)')).toBeInTheDocument();
    });
});

// Loading UX L6 (F16): before totals arrive the panel scans, never "0 / 0 · 0 %".
describe('SyncProgressPanel scanning', () => {
    const SCANNING: SyncProgress = { state: 'running', phase: 'scanning', phase_number: 1, completed: 0, total: 0, detail: 'Fixture detail' };
    afterEach(() => { vi.useRealTimers(); });

    it('a running sync with no total shows "getting ready" and an indeterminate bar, not 0 / 0 or 0%', () => {
        render(<SyncProgressPanel progress={SCANNING} />);
        expect(screen.getByText('Getting ready to sync…')).toBeInTheDocument();
        const bar = screen.getByRole('progressbar', { name: 'Sync progress' });
        expect(bar).not.toHaveAttribute('aria-valuenow');
        expect(screen.queryByText('0 / 0')).toBeNull();
        expect(screen.queryByText('0%')).toBeNull();
        expect(screen.getByTestId('sync-progress-fill')).toHaveClass('animate-progress-indeterminate', 'motion-reduce:animate-none');
    });

    it('a queued sync with no total is indeterminate too', () => {
        render(<SyncProgressPanel progress={{ state: 'queued', phase: 'queued', queue_position: 1 }} />);
        expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
        expect(screen.queryByText('0%')).toBeNull();
    });

    it('explains a long scan at 10 s (in Japanese too)', async () => {
        vi.useFakeTimers();
        await i18n.changeLanguage('ja');
        try {
            render(<SyncProgressPanel progress={SCANNING} />);
            expect(screen.getByText('同期の準備中…')).toBeInTheDocument();
            act(() => { vi.advanceTimersByTime(9999); });
            expect(screen.queryByText('新しいメッセージを確認しています。メッセージが多いと少し時間がかかります。')).toBeNull();
            act(() => { vi.advanceTimersByTime(1); });
            expect(screen.getByText('新しいメッセージを確認しています。メッセージが多いと少し時間がかかります。')).toHaveClass('text-small', 'text-secondary');
        } finally {
            await i18n.changeLanguage('en');
        }
    });

    it('switches to the determinate bar with the numbers once the total arrives', () => {
        const { rerender } = render(<SyncProgressPanel progress={SCANNING} />);
        rerender(<SyncProgressPanel progress={RUNNING} />);
        expect(screen.queryByText('Getting ready to sync…')).toBeNull();
        expect(screen.getByText('5 / 20')).toBeInTheDocument();
        expect(screen.getByText('25%')).toBeInTheDocument();
        const bar = screen.getByRole('progressbar', { name: 'Sync progress' });
        expect(bar).toHaveAttribute('aria-valuenow', '25');
        expect(bar).toHaveAttribute('aria-valuetext', '5 / 20');
        expect(screen.getByTestId('sync-progress-fill').style.width).toBe('25%');
    });

    it('the row spinners are the decorative Spinner next to their phase text', () => {
        const { rerender } = render(<SyncProgressPanel progress={RUNNING} />);
        const detail = screen.getByTestId('sync-detail').querySelector('svg');
        expect(detail).toHaveAttribute('data-spinner');
        expect(detail).toHaveAttribute('aria-hidden', 'true');
        rerender(<SyncProgressPanel progress={{ ...RUNNING, phase: 'downloading', phase_number: 3 }} />);
        expect(screen.getByTestId('sync-media-warning').querySelector('svg')).toHaveAttribute('data-spinner');
    });
});
