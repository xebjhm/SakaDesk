import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SyncModal } from './SyncModal';
import type { SyncProgress } from '../../features/messages/MessagesFeature';

// Mock i18n to return the key as-is (with interpolation params ignored)
vi.mock('../../i18n', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: 'en' },
    }),
}));

// Mock service data so getServiceById returns a predictable displayName
vi.mock('../../data/services', () => ({
    getServiceById: (id: string) => ({ displayName: `Service-${id}` }),
}));

const baseProgress: SyncProgress = {
    state: 'running',
    phase: 'scanning',
    phase_name: 'Scanning',
    phase_number: 1,
    completed: 5,
    total: 20,
    elapsed_seconds: 30,
    eta_seconds: 90,
    speed: 2.5,
    speed_unit: 'groups',
};

describe('SyncModal', () => {
    it('renders without crashing', () => {
        const { container } = render(<SyncModal syncProgress={baseProgress} />);
        expect(container.querySelector('.fixed')).toBeInTheDocument();
    });

    it('shows progress fraction', () => {
        render(<SyncModal syncProgress={baseProgress} />);
        // The component renders "completed / total" as "5 / 20"
        expect(screen.getByText('5 / 20')).toBeInTheDocument();
    });

    it('shows percentage', () => {
        render(<SyncModal syncProgress={baseProgress} />);
        // 5/20 = 25%
        expect(screen.getByText('25%')).toBeInTheDocument();
    });

    it('shows phase name via t() key for scanning phase', () => {
        render(<SyncModal syncProgress={baseProgress} />);
        // The header calls t('sync.phase', ...) which our mock returns as 'sync.phase'
        expect(screen.getByText('sync.phase')).toBeInTheDocument();
    });

    it('shows download phase with media warning', () => {
        const downloading: SyncProgress = {
            ...baseProgress,
            phase: 'downloading',
            phase_number: 3,
            completed: 100,
            total: 500,
        };
        render(<SyncModal syncProgress={downloading} />);
        // Phase 3 renders the media downloading warning
        expect(screen.getByText('sync.downloadingMedia')).toBeInTheDocument();
    });

    it('shows complete state', () => {
        const complete: SyncProgress = {
            ...baseProgress,
            state: 'complete',
            phase: 'complete',
            completed: 20,
            total: 20,
        };
        render(<SyncModal syncProgress={complete} />);
        expect(screen.getByText('sync.complete')).toBeInTheDocument();
        expect(screen.getByText('sync.syncComplete')).toBeInTheDocument();
    });

    it('shows sequential sync counter', () => {
        render(
            <SyncModal
                syncProgress={baseProgress}
                sequentialSyncInfo={{
                    currentService: 'hinatazaka46',
                    currentIndex: 0,
                    total: 2,
                }}
            />,
        );
        // The counter text is: "{serviceName} ({currentIndex+1}/{total})"
        // With our mock: "Service-hinatazaka46 (1/2)"
        expect(screen.getByText(/Service-hinatazaka46/)).toBeInTheDocument();
        expect(screen.getByText(/1\/2/)).toBeInTheDocument();
    });

    it('does not show sequential counter when total is 1', () => {
        render(
            <SyncModal
                syncProgress={baseProgress}
                sequentialSyncInfo={{
                    currentService: 'hinatazaka46',
                    currentIndex: 0,
                    total: 1,
                }}
            />,
        );
        // The counter section is gated by total > 1
        expect(screen.queryByText(/1\/1/)).toBeNull();
    });

    it('shows detail text when present', () => {
        const withDetail: SyncProgress = {
            ...baseProgress,
            detail: 'Processing group Alpha',
        };
        render(<SyncModal syncProgress={withDetail} />);
        expect(screen.getByText(/Processing group Alpha/)).toBeInTheDocument();
    });

    it('shows detail with detail_extra', () => {
        const withExtra: SyncProgress = {
            ...baseProgress,
            detail: 'Fetching',
            detail_extra: '(page 3)',
        };
        render(<SyncModal syncProgress={withExtra} />);
        expect(screen.getByText(/Fetching \(page 3\)/)).toBeInTheDocument();
    });

    it('shows elapsed time and ETA', () => {
        render(<SyncModal syncProgress={baseProgress} />);
        // elapsed_seconds=30 => formatSyncTime => "00:30"
        expect(screen.getByText('00:30')).toBeInTheDocument();
        // eta_seconds=90 => formatSyncTime => "01:30"
        expect(screen.getByText('01:30')).toBeInTheDocument();
    });

    it('shows speed', () => {
        render(<SyncModal syncProgress={baseProgress} />);
        // speed=2.5, unit="groups" => "2.50 groups/s"
        expect(screen.getByText('2.50 groups/s')).toBeInTheDocument();
    });

    it('shows fallback ETA when eta_seconds is null', () => {
        const noEta: SyncProgress = {
            ...baseProgress,
            eta_seconds: null,
        };
        render(<SyncModal syncProgress={noEta} />);
        expect(screen.getByText('--:--')).toBeInTheDocument();
    });

    it('shows phase dots for scanning, syncing, downloading', () => {
        render(<SyncModal syncProgress={baseProgress} />);
        // Phase dot labels use t() keys
        expect(screen.getByText('sync.scan')).toBeInTheDocument();
        expect(screen.getByText('sync.syncing')).toBeInTheDocument();
        expect(screen.getByText('sync.download')).toBeInTheDocument();
    });
});
