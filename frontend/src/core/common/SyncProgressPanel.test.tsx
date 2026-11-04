// frontend/src/core/common/SyncProgressPanel.test.tsx
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { SyncProgressPanel } from './SyncProgressPanel';
import type { SyncProgress } from '../../features/messages/MessagesFeature';

beforeAll(async () => { await i18n.changeLanguage('en'); });

const RUNNING: SyncProgress = {
    state: 'running', phase: 'syncing', phase_number: 2, completed: 5, total: 20,
    elapsed_seconds: 30, eta_seconds: 90, speed: 2.5, speed_unit: 'members', detail: 'Fixture detail',
};

describe('SyncProgressPanel', () => {
    it('shows the count, the percent and a named progress bar filled in the action colour', () => {
        render(<SyncProgressPanel progress={RUNNING} />);
        expect(screen.getByText('5 / 20')).toBeInTheDocument();
        expect(screen.getByText('25%')).toBeInTheDocument();
        const bar = screen.getByRole('progressbar', { name: 'Sync progress' });
        expect(bar).toHaveAttribute('aria-valuenow', '25');
        const fill = bar.firstElementChild as HTMLElement;
        expect(fill).toHaveClass('bg-group-accent');
        expect(fill.style.width).toBe('25%');
    });

    it('shows the detail row only while running', () => {
        const { rerender } = render(<SyncProgressPanel progress={RUNNING} />);
        expect(screen.getByText('Fixture detail').closest('div')).toHaveClass('bg-group-subtle');
        rerender(<SyncProgressPanel progress={{ ...RUNNING, state: 'complete', phase: 'complete' }} />);
        expect(screen.queryByText('Fixture detail')).toBeNull();
    });

    it('the media phase row is neutral with a warning spinner', () => {
        render(<SyncProgressPanel progress={{ ...RUNNING, phase: 'downloading', phase_number: 3 }} />);
        const row = screen.getByText('Downloading media... Please do not close the app.').closest('div') as HTMLElement;
        expect(row).toHaveClass('bg-sunken');
        expect(row.querySelector('svg')).toHaveClass('text-status-warning');
    });

    it('marks done, current and pending phase steps', () => {
        render(<SyncProgressPanel progress={RUNNING} />);
        const dot = (label: string) => screen.getByText(label).closest('li')!.querySelector('span[aria-hidden="true"]');
        expect(dot('Scan')).toHaveClass('bg-status-success');
        expect(screen.getByText('Syncing...').closest('li')).toHaveAttribute('aria-current', 'step');
        expect(dot('Syncing...')).toHaveClass('bg-group-accent', 'shadow-group-glow');
        expect(screen.getByText('Syncing...')).toHaveClass('text-group-strong');
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

    it('a zero total shows 0%', () => {
        render(<SyncProgressPanel progress={{ ...RUNNING, total: 0, completed: 0 }} />);
        expect(screen.getByText('0%')).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    });

    it('discovering counts as the scan step being current', () => {
        render(<SyncProgressPanel progress={{ ...RUNNING, phase: 'discovering' }} />);
        expect(screen.getByText('Scan').closest('li')).toHaveAttribute('aria-current', 'step');
    });
});
