import type { SyncProgress } from '../features/messages/MessagesFeature';

/** Format elapsed/ETA seconds as MM:SS or H:MM:SS. */
export const formatSyncTime = (seconds: number | undefined): string => {
    if (!seconds || seconds <= 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m >= 60) {
        const h = Math.floor(m / 60);
        return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/** Format sync speed as "X.XX unit/s". */
export const formatSyncSpeed = (speed: number | null | undefined, unit: string): string => {
    const parts = formatSyncSpeedParts(speed, unit);
    return parts.value ? `${parts.value} ${parts.unit}` : '';
};

/** The speed split into its number and its unit ("files/s"), for a tile that stacks them. */
export const formatSyncSpeedParts = (
    speed: number | null | undefined,
    unit: string,
): { value: string; unit: string } => {
    if (!speed || speed <= 0) return { value: '', unit: '' };
    const decimals = speed >= 10 ? 1 : 2;
    return { value: speed.toFixed(decimals), unit: `${unit}/s` };
};

/** Get the localized phase name for a sync progress state. */
export function getSyncPhaseName(
    syncProgress: SyncProgress,
    t: (key: string) => string,
): string {
    const phaseNameMap: Record<string, string> = {
        queued: t('sync.phaseQueued'),
        scanning: t('sync.phaseScanning'),
        discovering: t('sync.phaseDiscovering'),
        syncing: t('sync.phaseSyncing'),
        downloading: t('sync.phaseDownloading'),
        verifying: t('sync.phaseVerifying'),
        repairing: t('sync.phaseRepairing'),
    };
    return phaseNameMap[syncProgress.phase || ''] || syncProgress.phase_name || t('sync.starting');
}

/** Get the localized unit label (members/files/items) for the current phase. */
export function getSyncUnitLabel(
    syncProgress: SyncProgress,
    t: (key: string) => string,
): string {
    // The verify/fix flow reuses phase_number 1/2 with different meanings than the
    // regular sync flow (which uses 1/2/3), so disambiguate by phase name first.
    if (syncProgress.phase === 'verifying') return t('sync.members');
    if (syncProgress.phase === 'repairing') return t('sync.files');
    if (syncProgress.phase_number === 2) return t('sync.members');
    if (syncProgress.phase_number === 3) return t('sync.files');
    return t('sync.items');
}

/** Detail line for a sync progress state; prefixes known detail codes with their localized text. */
export function getSyncDetail(
    syncProgress: SyncProgress,
    t: (key: string, options?: Record<string, unknown>) => string,
    fallback: string,
): string {
    if (syncProgress.state === 'queued') {
        return t('sync.queuedDetail', { position: syncProgress.queue_position ?? 1 });
    }
    const detail = syncProgress.detail || '';
    if (syncProgress.detail_code === 'scanning_history') {
        const scanning = t('sync.scanningHistory');
        return detail ? `${scanning} · ${detail}` : scanning;
    }
    return detail || fallback;
}

/** A sync that is running or waiting in the backend queue (the UI shows its progress / Cancel). */
export function isSyncActive(syncProgress: SyncProgress | undefined | null): syncProgress is SyncProgress {
    return syncProgress?.state === 'running' || syncProgress?.state === 'queued';
}

/**
 * The ETA tile's text: a time only when the backend could estimate one. `not_estimable`
 * (work per unit unknown: scanning, collecting metadata) shows a dash, `warming_up` (media
 * phase before enough evidence) shows "Estimating…".
 */
export function formatSyncEta(
    syncProgress: SyncProgress,
    t: (key: string) => string,
): string {
    if (syncProgress.eta_seconds) return formatSyncTime(syncProgress.eta_seconds);
    if (syncProgress.eta_reason === 'not_estimable') return '—';
    if (syncProgress.eta_reason === 'warming_up') return t('time.etaEstimating');
    return '--:--';
}
