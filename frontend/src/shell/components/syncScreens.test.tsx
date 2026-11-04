// frontend/src/shell/components/syncScreens.test.tsx
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { SyncModal } from './SyncModal';
import { InlineSyncView } from '../../core/layout/InlineSyncView';
import { groupRoles } from '../../design/tokens';
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

    it('a sequential sync shows the syncing service’s colours and its step bars', () => {
        render(<SyncModal syncProgress={RUNNING} sequentialSyncInfo={{ total: 2, currentIndex: 1, currentService: 'sakurazaka46' }} />);
        const bar = screen.getByRole('progressbar');
        const scope = bar.closest('[style*="--ds-group-accent"]') as HTMLElement;
        expect(scope.style.getPropertyValue('--ds-group-accent')).toBe(groupRoles('sakurazaka').action);
        expect(scope.querySelectorAll('span.h-1.rounded-pill.bg-group-accent')).toHaveLength(2);
    });

    it('Done and Cancel are secondary buttons', () => {
        const { rerender } = render(<SyncModal syncProgress={RUNNING} onCancel={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Cancel' })).not.toHaveClass('bg-group-accent');
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
