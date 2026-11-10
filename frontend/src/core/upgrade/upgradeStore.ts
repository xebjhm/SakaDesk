import { create } from 'zustand';
import { persisted } from '../persistence/persisted';

/**
 * The one in-app upgrade state, shared by the rail's UpgradeIcon and the Settings
 * "Updates" tab, so both always show the same stage and act on the same download.
 * The backend (`/api/version/upgrade/*`) owns the real state; this store mirrors it
 * and polls `/upgrade/status` while a download runs.
 */

export interface VersionInfo {
    current_version: string;
    latest_version: string | null;
    update_available: boolean;
    release_url: string | null;
    release_notes: string | null;
    error: string | null;
    upgrade_supported: boolean;
}

export interface UpgradeStatus {
    state: 'idle' | 'downloading' | 'ready' | 'launching' | 'error';
    progress: number;
    error: string | null;
    version: string | null;
}

export type UpgradeStage = 'hidden' | 'available' | 'downloading' | 'ready' | 'launching' | 'error';

/** Result of a version check: the new info, or null when the check failed. */
export type CheckResult = VersionInfo | null;

interface UpgradeState {
    versionInfo: VersionInfo | null;
    status: UpgradeStatus | null;
    /** The user skipped this latest version (rail icon hidden; Settings still offers it). */
    dismissed: boolean;
    /** Auto-download already ran (or the user cancelled) this app session. */
    autoDownloadTriggered: boolean;
    checkVersion: (force?: boolean) => Promise<CheckResult>;
    startDownload: () => Promise<void>;
    install: () => Promise<void>;
    cancel: () => Promise<void>;
    /** Clear an error (backend cancel + local reset) without retrying. */
    dismissError: () => void;
    /** Hide the rail icon for the current latest version. */
    skipVersion: () => void;
    /** Clear the error, then start the download again. */
    retry: () => Promise<void>;
    markAutoDownloadTriggered: () => void;
}

const POLL_MS = 500;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function syncPolling(status: UpgradeStatus | null) {
    const downloading = status?.state === 'downloading';
    if (downloading && !pollTimer) {
        pollTimer = setInterval(() => { void pollStatus(); }, POLL_MS);
    } else if (!downloading && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

function setStatus(status: UpgradeStatus | null) {
    useUpgradeStore.setState({ status });
    syncPolling(status);
}

async function pollStatus() {
    try {
        const res = await fetch('/api/version/upgrade/status');
        if (res.ok) setStatus(await res.json());
    } catch (err) {
        console.warn('[upgrade] Status poll failed:', err);
    }
}

function failed(error: string | null, progress = 0): UpgradeStatus {
    const version = useUpgradeStore.getState().status?.version ?? null;
    return { state: 'error', progress, error, version };
}

/** The stage to show. Settings passes `ignoreDismissed` so a skipped version can still be installed there. */
export function upgradeStage(
    state: Pick<UpgradeState, 'status' | 'versionInfo' | 'dismissed'>,
    ignoreDismissed = false,
): UpgradeStage {
    const s = state.status?.state;
    if (s === 'error' || s === 'launching' || s === 'ready' || s === 'downloading') return s;
    if (state.versionInfo?.update_available && (ignoreDismissed || !state.dismissed)) return 'available';
    return 'hidden';
}

/** Open the GitHub release page (platforms without in-place upgrade). */
export function openReleasePage(url: string | null | undefined) {
    if (url && /^https:\/\/github\.com\//.test(url)) window.open(url, '_blank');
}

export const useUpgradeStore = create<UpgradeState>()((set, get) => ({
    versionInfo: null,
    status: null,
    dismissed: false,
    autoDownloadTriggered: false,

    checkVersion: async (force = false) => {
        try {
            // force=true bypasses the backend's 1 h cache (manual checks only).
            const res = await fetch(force ? '/api/version?force=true' : '/api/version');
            if (!res.ok) return null;
            const data: VersionInfo = await res.json();
            const skipped = persisted.getPref<string | null>('dismissed_update', null);
            set((prev) => ({
                versionInfo: data,
                dismissed: skipped === data.latest_version ? true : data.update_available ? false : prev.dismissed,
            }));
            return data;
        } catch (err) {
            console.warn('[upgrade] Version check failed:', err);
            return null;
        }
    },

    startDownload: async () => {
        try {
            const res = await fetch('/api/version/upgrade/start', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setStatus({ state: 'downloading', progress: 0, error: null, version: data.version });
            } else {
                setStatus(failed(data.error ?? null));
            }
        } catch (err) {
            console.warn('[upgrade] Start failed:', err);
            setStatus(failed(null));
        }
    },

    install: async () => {
        try {
            const res = await fetch('/api/version/upgrade/install', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                const prev = get().status;
                setStatus(prev ? { ...prev, state: 'launching' } : { state: 'launching', progress: 100, error: null, version: null });
                // Close the window after a short delay to let the installer start.
                // The backend also exits after ~2 seconds as a fallback.
                setTimeout(() => window.close(), 1500);
            } else {
                setStatus(failed(data.error ?? null, 100));
            }
        } catch (err) {
            console.warn('[upgrade] Install failed:', err);
            setStatus(failed(null, 100));
        }
    },

    cancel: async () => {
        let cancelled = false;
        try {
            const res = await fetch('/api/version/upgrade/cancel', { method: 'POST' });
            const data = res.ok ? await res.json() : null;
            cancelled = data?.success === true;
            if (!cancelled) console.warn('[upgrade] Cancel refused:', res.status);
        } catch (err) {
            console.warn('[upgrade] Cancel request failed:', err);
        }
        // A user cancel must not make auto-download start again this session.
        set({ autoDownloadTriggered: true });
        if (cancelled) {
            setStatus(null);
            return;
        }
        // The cancel did not go through: show what the backend is really doing
        // (a download may still be running) instead of pretending it stopped.
        await pollStatus();
    },

    dismissError: () => {
        fetch('/api/version/upgrade/cancel', { method: 'POST' }).catch((err) => {
            console.warn('[upgrade] Cancel on dismiss failed:', err);
        });
        setStatus(null);
    },

    skipVersion: () => {
        const latest = get().versionInfo?.latest_version;
        if (!latest) return;
        persisted.setPref('dismissed_update', latest);
        set({ dismissed: true });
    },

    retry: async () => {
        try {
            await fetch('/api/version/upgrade/cancel', { method: 'POST' });
        } catch (err) {
            console.warn('[upgrade] Cancel before retry failed:', err);
        }
        setStatus(null);
        await get().startDownload();
    },

    markAutoDownloadTriggered: () => set({ autoDownloadTriggered: true }),
}));

/** Test helper: back to the initial state with no poll running. */
export function resetUpgradeStoreForTests() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    useUpgradeStore.setState({ versionInfo: null, status: null, dismissed: false, autoDownloadTriggered: false });
}
