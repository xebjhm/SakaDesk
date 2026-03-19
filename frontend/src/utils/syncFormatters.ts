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
    if (!speed || speed <= 0) return '';
    const decimals = speed >= 10 ? 1 : 2;
    return `${speed.toFixed(decimals)} ${unit}/s`;
};

/** Get the localized phase name for a sync progress state. */
export function getSyncPhaseName(
    syncProgress: SyncProgress,
    t: (key: string) => string,
): string {
    const phaseNameMap: Record<string, string> = {
        scanning: t('sync.phaseScanning'),
        discovering: t('sync.phaseDiscovering'),
        syncing: t('sync.phaseSyncing'),
        downloading: t('sync.phaseDownloading'),
    };
    return phaseNameMap[syncProgress.phase || ''] || syncProgress.phase_name || t('sync.starting');
}

/** Get the localized unit label (members/files/items) for the current phase. */
export function getSyncUnitLabel(
    syncProgress: SyncProgress,
    t: (key: string) => string,
): string {
    if (syncProgress.phase_number === 2) return t('sync.members');
    if (syncProgress.phase_number === 3) return t('sync.files');
    return t('sync.items');
}
