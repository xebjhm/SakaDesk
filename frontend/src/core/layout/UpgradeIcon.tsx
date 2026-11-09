import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, ArrowUpCircle, Loader2, X, AlertCircle } from 'lucide-react';
import { cn } from '../../utils/classnames';
import { useTranslation } from '../../i18n';
import { persisted } from '../persistence/persisted';

// SVG progress ring constants (hoisted to avoid recomputation on every render)
const RING_RADIUS = 18;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface VersionInfo {
    current_version: string;
    latest_version: string | null;
    update_available: boolean;
    release_url: string | null;
    release_notes: string | null;
    error: string | null;
    upgrade_supported: boolean;
}

interface UpgradeStatus {
    state: 'idle' | 'downloading' | 'ready' | 'launching' | 'error';
    progress: number;
    error: string | null;
    version: string | null;
}

type Stage = 'hidden' | 'available' | 'downloading' | 'ready' | 'launching' | 'error';

/**
 * Upgrade icon for the service rail (Zone A).
 *
 * Two-stage UX:
 * - Stage 1 (available): Download arrow + blue dot — click to start download
 * - Stage 2 (ready): Restart arrow + green dot — click to launch installer
 *
 * When auto_download_updates is ON, Stage 1 is skipped (download starts silently).
 * While downloading, clicking the ring does nothing; the hover × cancels, and a
 * cancelled download is not restarted automatically until the next app start.
 */
export function UpgradeIcon() {
    const { t } = useTranslation();
    const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
    const [upgradeStatus, setUpgradeStatus] = useState<UpgradeStatus | null>(null);
    const [dismissed, setDismissed] = useState(false);
    const [autoDownload, setAutoDownload] = useState(false);
    const autoDownloadTriggered = useRef(false);

    // Determine current stage
    const stage: Stage = (() => {
        if (upgradeStatus?.state === 'error') return 'error';
        if (upgradeStatus?.state === 'launching') return 'launching';
        if (upgradeStatus?.state === 'ready') return 'ready';
        if (upgradeStatus?.state === 'downloading') return 'downloading';
        if (versionInfo?.update_available && !dismissed) return 'available';
        return 'hidden';
    })();

    // Fetch auto_download setting on mount
    useEffect(() => {
        fetch('/api/settings')
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data?.auto_download_updates !== undefined) {
                    setAutoDownload(data.auto_download_updates);
                }
            })
            .catch((err) => {
                console.warn('[UpgradeIcon] Failed to fetch auto-download setting:', err);
            });
    }, []);

    // Check version on mount and periodically
    useEffect(() => {
        const checkVersion = async () => {
            try {
                const res = await fetch('/api/version');
                if (res.ok) {
                    const data: VersionInfo = await res.json();
                    setVersionInfo(data);

                    const dismissedVersion = persisted.getPref<string | null>('dismissed_update', null);
                    if (dismissedVersion === data.latest_version) {
                        setDismissed(true);
                    } else if (data.update_available) {
                        setDismissed(false);
                    }
                }
            } catch (err) {
                console.warn('[UpgradeIcon] Version check failed:', err);
            }
        };

        checkVersion();
        const interval = setInterval(checkVersion, 60 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    const handleStartDownload = useCallback(async () => {
        try {
            const res = await fetch('/api/version/upgrade/start', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setUpgradeStatus({ state: 'downloading', progress: 0, error: null, version: data.version });
            } else {
                setUpgradeStatus({ state: 'error', progress: 0, error: data.error, version: null });
            }
        } catch {
            setUpgradeStatus({ state: 'error', progress: 0, error: t('update.upgradeFailed'), version: null });
        }
    }, [t]);

    // Auto-download when enabled and update is available
    useEffect(() => {
        if (
            autoDownload &&
            stage === 'available' &&
            versionInfo?.upgrade_supported &&
            !autoDownloadTriggered.current
        ) {
            autoDownloadTriggered.current = true;
            handleStartDownload();
        }
    }, [autoDownload, stage, versionInfo?.upgrade_supported, handleStartDownload]);

    // Poll upgrade status while downloading
    const shouldPoll = upgradeStatus?.state === 'downloading';
    useEffect(() => {
        if (!shouldPoll) return;

        const poll = async () => {
            try {
                const res = await fetch('/api/version/upgrade/status');
                if (res.ok) {
                    const status: UpgradeStatus = await res.json();
                    setUpgradeStatus(status);
                }
            } catch (err) {
                console.warn('[UpgradeIcon] Status poll failed:', err);
            }
        };

        const interval = setInterval(poll, 500);
        return () => clearInterval(interval);
    }, [shouldPoll]);

    const handleInstall = useCallback(async () => {
        try {
            const res = await fetch('/api/version/upgrade/install', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setUpgradeStatus(prev => prev ? { ...prev, state: 'launching' } : null);
                // Close the window after a short delay to let the installer start.
                // The backend also exits after ~2 seconds as a fallback.
                setTimeout(() => window.close(), 1500);
            } else {
                setUpgradeStatus({ state: 'error', progress: 100, error: data.error, version: upgradeStatus?.version || null });
            }
        } catch {
            setUpgradeStatus({ state: 'error', progress: 100, error: t('update.upgradeFailed'), version: upgradeStatus?.version || null });
        }
    }, [upgradeStatus, t]);

    const handleDismiss = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (stage === 'available' && versionInfo?.latest_version) {
            persisted.setPref('dismissed_update', versionInfo.latest_version);
            setDismissed(true);
        }
        if (stage === 'error') {
            // Cancel on error dismiss
            fetch('/api/version/upgrade/cancel', { method: 'POST' }).catch((err) => {
                console.warn('[UpgradeIcon] Cancel on dismiss failed:', err);
            });
            setUpgradeStatus(null);
        }
    }, [stage, versionInfo]);

    const handleCancel = useCallback(async () => {
        let cancelled = false;
        try {
            const res = await fetch('/api/version/upgrade/cancel', { method: 'POST' });
            const data = res.ok ? await res.json() : null;
            cancelled = data?.success === true;
            if (!cancelled) console.warn('[UpgradeIcon] Cancel refused:', res.status);
        } catch (err) {
            console.warn('[UpgradeIcon] Cancel request failed:', err);
        }
        // Keep autoDownloadTriggered set: a user cancel must not make auto-download
        // start again right away (it restarts on the next app start).
        if (cancelled) {
            setUpgradeStatus(null);
            return;
        }
        // The cancel did not go through: show what the backend is really doing
        // (a download may still be running) instead of pretending it stopped.
        try {
            const res = await fetch('/api/version/upgrade/status');
            if (res.ok) setUpgradeStatus(await res.json());
        } catch (err) {
            console.warn('[UpgradeIcon] Status after failed cancel failed:', err);
        }
    }, []);

    // For non-Windows: open release page in browser
    const handleOpenRelease = useCallback(() => {
        const url = versionInfo?.release_url;
        if (url && /^https:\/\/github\.com\//.test(url)) {
            window.open(url, '_blank');
        }
    }, [versionInfo?.release_url]);

    if (stage === 'hidden') return null;

    const progress = upgradeStatus?.progress ?? 0;
    const version = upgradeStatus?.version || versionInfo?.latest_version || '';

    // Compute ring offset from current progress
    const ringOffset = RING_CIRCUMFERENCE - (progress / 100) * RING_CIRCUMFERENCE;

    const tooltip = (() => {
        switch (stage) {
            case 'available': return t('update.updateAvailable') + ` v${version}`;
            case 'downloading': return `${t('update.downloading', { version })} ${Math.round(progress)}%`;
            case 'ready': return t('update.readyToInstall', { version });
            case 'launching': return t('update.installing');
            case 'error': return `${t('update.upgradeFailed')} ${upgradeStatus?.error || ''}`;
            default: return '';
        }
    })();

    const handleClick = () => {
        switch (stage) {
            case 'available':
                if (versionInfo?.upgrade_supported) {
                    handleStartDownload();
                } else {
                    handleOpenRelease();
                }
                break;
            case 'downloading':
                // A click on the ring does nothing while downloading: cancelling
                // is the hover × only, so a stray click cannot restart the download.
                break;
            case 'ready':
                handleInstall();
                break;
        }
    };

    return (
        <div className="relative group">
            <button
                onClick={handleClick}
                onContextMenu={(e) => {
                    e.preventDefault();
                    if (stage === 'available') handleDismiss(e);
                }}
                className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-full transition duration-fast ease-standard hover:brightness-94',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    stage === 'error'
                        ? 'bg-semantic-danger-icon text-semantic-danger'
                        : stage === 'ready'
                        ? 'bg-semantic-success-icon text-semantic-success'
                        : 'bg-semantic-info-icon text-semantic-info',
                )}
                title={tooltip}
            >
                {/* Progress ring for downloading state */}
                {stage === 'downloading' && (
                    <svg className="absolute inset-0 h-11 w-11 -rotate-90" viewBox="0 0 44 44">
                        <circle
                            cx="22" cy="22" r={RING_RADIUS}
                            fill="none" stroke="currentColor" strokeWidth="2.5"
                            strokeDasharray={RING_CIRCUMFERENCE}
                            strokeDashoffset={ringOffset}
                            className="text-accent transition-[stroke-dashoffset] duration-base ease-standard"
                            strokeLinecap="round"
                        />
                    </svg>
                )}

                {/* Icon */}
                {stage === 'error' ? (
                    <AlertCircle className="h-5 w-5" />
                ) : stage === 'launching' ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                ) : stage === 'ready' ? (
                    <ArrowUpCircle className="h-5 w-5" />
                ) : (
                    <Download className="h-5 w-5" />
                )}

                {/* Notification dot */}
                {(stage === 'available' || stage === 'ready') && (
                    <span className={cn(
                        'absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-surface',
                        stage === 'available' ? 'bg-accent' : 'bg-status-success',
                    )} />
                )}
            </button>

            {/* Hover ×: skip (available), cancel (error) or cancel the download */}
            {(stage === 'available' || stage === 'error' || stage === 'downloading') && (
                <button
                    onClick={stage === 'downloading' ? (e) => { e.stopPropagation(); void handleCancel(); } : handleDismiss}
                    aria-label={stage === 'downloading' ? t('update.cancelDownload') : stage === 'error' ? t('common.cancel') : t('update.skipVersion')}
                    className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-control-off text-primary transition-colors duration-fast ease-standard hover:brightness-94 group-hover:flex"
                    title={stage === 'downloading' ? t('update.cancelDownload') : stage === 'error' ? t('common.cancel') : t('update.skipVersion')}
                >
                    <X className="h-2.5 w-2.5" />
                </button>
            )}
        </div>
    );
}
