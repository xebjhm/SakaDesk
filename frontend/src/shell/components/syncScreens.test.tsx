// frontend/src/shell/components/syncScreens.test.tsx
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import i18n from '../../i18n';
import { SyncModal } from './SyncModal';
import { InlineSyncView } from '../../core/layout/InlineSyncView';
import { brandAccent, groupAccent, groupRoles } from '../../design/tokens';
import type { SyncProgress } from '../../features/messages/MessagesFeature';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

const RUNNING: SyncProgress = {
    state: 'running', phase: 'scanning', phase_number: 1, completed: 5, total: 20,
    elapsed_seconds: 30, eta_seconds: 90, speed: 2.5, speed_unit: 'groups', detail: 'Fixture detail',
};

describe('sync dialog (D2d)', () => {
    it('is a standard dialog: its title is the h2 and there is no fixed id', () => {
        render(<SyncModal syncProgress={RUNNING} />);
        const heading = screen.getByRole('heading', { level: 2, name: 'Phase 1: Scanning Groups' });
        expect(screen.getByRole('dialog', { name: 'Phase 1: Scanning Groups' })).toContainElement(heading);
        expect(document.getElementById('sync-title')).toBeNull();
    });

    it('Done and Cancel are secondary buttons', () => {
        const { rerender } = render(<SyncModal syncProgress={RUNNING} onCancel={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Cancel' })).not.toHaveClass('bg-accent-gradient');
        rerender(<SyncModal syncProgress={{ ...RUNNING, state: 'complete', phase: 'complete' }} onClose={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Done' })).toHaveClass('bg-pill');
    });
});

describe('inline sync view (D2d)', () => {
    it('Hinatazaka: the gradient banner on a card scoped to the service', () => {
        render(<InlineSyncView service="hinatazaka46" syncProgress={RUNNING} />);
        const banner = screen.getByTestId('inline-sync-banner');
        expect(banner).toHaveClass('bg-group-title', 'text-inverse');
        const card = banner.parentElement as HTMLElement;
        expect(card).toHaveClass('rounded-card');
        expect(card.style.getPropertyValue('--ds-group-accent')).toBe(groupRoles('hinatazaka').action);
    });

    it('Sakurazaka: the light banner with the title bar under it', () => {
        render(<InlineSyncView service="sakurazaka46" syncProgress={RUNNING} />);
        const banner = screen.getByTestId('inline-sync-banner');
        expect(banner).toHaveClass('bg-card', 'text-group-title');
        expect(banner.nextElementSibling).toHaveClass('bg-group-title-bar');
    });
});

const VERIFIED: SyncProgress = {
    state: 'complete', phase: 'complete', phase_number: 3, completed: 40, total: 40,
    elapsed_seconds: 12, eta_seconds: 0, speed: 3, speed_unit: 'files',
    result: {
        members: 2, checked: 40, missing: 3, repaired: 1, failed: 0, still_missing: 2, unresolved: 1,
        unresolved_items: [{ member: '金村 美玖', timestamp: '2026-11-01T10:00:00Z', media_type: 'voice' }],
    },
};

describe('sync dialog (R-d, pending decision D5)', () => {
    it('is a brand dialog with the download icon and the aurora fill on a 16 px track (pending decision D1)', () => {
        render(<SyncModal syncProgress={RUNNING} />);
        const dialog = screen.getByRole('dialog', { name: 'Phase 1: Scanning Groups' });
        expect(dialog).toHaveAttribute('data-scope', 'brand');
        expect(dialog.style.getPropertyValue('--ds-expressive-progress')).toBe(brandAccent().progress);
        expect(screen.getByTestId('modal-header-icon').querySelector('svg.lucide-download')).not.toBeNull();
        expect(screen.getByRole('progressbar')).toHaveClass('h-4', 'bg-sunken');
        expect(screen.getByTestId('sync-progress-fill')).toHaveClass('bg-expressive-progress');
    });

    it('draws each step of a sequential sync in its own group colour and names the current group', () => {
        render(<SyncModal syncProgress={RUNNING} sequentialSyncInfo={{ total: 2, currentIndex: 1, currentService: 'sakurazaka46', services: ['hinatazaka46', 'sakurazaka46'] }} />);
        const done = screen.getByTestId('sync-step-hinatazaka46');
        const current = screen.getByTestId('sync-step-sakurazaka46');
        expect(done.style.getPropertyValue('--ds-accent')).toBe(groupRoles('hinatazaka').action);
        expect(current.style.getPropertyValue('--ds-accent')).toBe(groupRoles('sakurazaka').action);
        expect(done).toHaveClass('w-6', 'bg-accent');
        expect(current).toHaveClass('w-10', 'bg-accent');
        const chip = screen.getByTestId('sync-service-chip');
        expect(chip.style.getPropertyValue('--ds-accent')).toBe(groupRoles('sakurazaka').action);
        expect(within(chip).getByText('櫻坂46 (2/2)')).toHaveAttribute('lang', 'ja');
        // The panel itself stays brand.
        expect(screen.getByTestId('sync-detail').closest('[style*="--ds-group-accent"]')).toBeNull();
    });

    it('shows the running step and the detail row in the ink accent (e4e4118: blue-500, ring-blue-100, bg-blue-50)', () => {
        render(<SyncModal syncProgress={RUNNING} />);
        expect(screen.getByTestId('sync-step-dot-scanning')).toHaveClass('bg-accent', 'ring-4', 'ring-accent-subtle');
        expect(screen.getByText('Scan')).toHaveClass('text-accent-strong');
        expect(screen.getByTestId('sync-detail')).toHaveClass('bg-accent-subtle');
        expect(screen.getByTestId('sync-detail').querySelector('svg')).toHaveClass('text-accent');
    });

    it('warns about the media phase in the semantic warning colours (e4e4118: amber-50 / amber-100 / amber-700)', () => {
        render(<SyncModal syncProgress={{ ...RUNNING, phase: 'downloading', phase_number: 3 }} />);
        expect(screen.getByTestId('sync-media-warning')).toHaveClass('bg-semantic-warning-subtle', 'border-semantic-warning', 'text-semantic-warning');
    });

    it('lists unresolved items on a warning panel with Japanese member names', () => {
        render(<SyncModal syncProgress={VERIFIED} onClose={vi.fn()} />);
        const panel = screen.getByTestId('sync-unresolved');
        expect(panel).toHaveClass('border', 'border-semantic-warning');
        expect(panel.firstElementChild).toHaveClass('bg-semantic-warning-subtle', 'text-semantic-warning');
        expect(within(panel).getByText('金村 美玖')).toHaveAttribute('lang', 'ja');
    });
});

describe('inline sync view (R-d)', () => {
    it('keeps its group: the accent-subtle disc and the official bar as the progress fill on Sakurazaka', () => {
        render(<InlineSyncView service="sakurazaka46" syncProgress={RUNNING} />);
        const banner = screen.getByTestId('inline-sync-banner');
        expect(banner.querySelector('span[aria-hidden="true"]')).toHaveClass('bg-accent-subtle');
        const card = banner.parentElement as HTMLElement;
        expect(card.style.getPropertyValue('--ds-expressive-progress')).toBe(groupAccent('sakurazaka').progress);
        expect(screen.getByTestId('sync-progress-fill')).toHaveClass('bg-expressive-progress');
    });
});
