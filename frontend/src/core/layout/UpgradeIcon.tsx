import { useState, useEffect } from 'react';
import { Download, ArrowUpCircle, X, AlertCircle } from 'lucide-react';
import { cn } from '../../utils/classnames';
import { useTranslation } from '../../i18n';
import { Spinner } from '../../design/primitives';
import { useUpgradeStore, upgradeStage, openReleasePage } from '../upgrade/upgradeStore';

// SVG progress ring constants (hoisted to avoid recomputation on every render)
const RING_RADIUS = 18;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Upgrade icon for the service rail (Zone A).
 *
 * Two-stage UX:
 * - Stage 1 (available): Download arrow + blue dot — click to start download
 * - Stage 2 (ready): Restart arrow + green dot — click to launch installer
 *
 * State lives in the shared upgrade store (also used by Settings → Updates).
 * When auto_download_updates is ON, Stage 1 is skipped (download starts silently).
 * While downloading, clicking the ring does nothing; the hover × cancels, and a
 * cancelled download is not restarted automatically until the next app start.
 */
export function UpgradeIcon() {
    const { t } = useTranslation();
    const versionInfo = useUpgradeStore((st) => st.versionInfo);
    const upgradeStatus = useUpgradeStore((st) => st.status);
    const dismissed = useUpgradeStore((st) => st.dismissed);
    const autoDownloadTriggered = useUpgradeStore((st) => st.autoDownloadTriggered);
    const { checkVersion, startDownload, install, cancel, dismissError, skipVersion, markAutoDownloadTriggered } =
        useUpgradeStore.getState();
    const [autoDownload, setAutoDownload] = useState(false);

    const stage = upgradeStage({ status: upgradeStatus, versionInfo, dismissed });

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

    // Check version on mount and hourly (the store is shared with Settings).
    useEffect(() => {
        void checkVersion();
        const interval = setInterval(() => { void checkVersion(); }, 60 * 60 * 1000);
        return () => clearInterval(interval);
    }, [checkVersion]);

    // Auto-download when enabled and update is available (once per app session;
    // a user cancel also counts, so it is not restarted right away).
    useEffect(() => {
        if (autoDownload && stage === 'available' && versionInfo?.upgrade_supported && !autoDownloadTriggered) {
            markAutoDownloadTriggered();
            void startDownload();
        }
    }, [autoDownload, stage, versionInfo?.upgrade_supported, autoDownloadTriggered, markAutoDownloadTriggered, startDownload]);

    const handleDismiss = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (stage === 'available') skipVersion();
        if (stage === 'error') dismissError();
    };

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
                    void startDownload();
                } else {
                    openReleasePage(versionInfo?.release_url);
                }
                break;
            case 'downloading':
                // A click on the ring does nothing while downloading: cancelling
                // is the hover × only, so a stray click cannot restart the download.
                break;
            case 'ready':
                void install();
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
                    <Spinner size="md" tone="current" label={t('update.installing')} labelVisibility="compact" />
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
                    onClick={stage === 'downloading' ? (e) => { e.stopPropagation(); void cancel(); } : handleDismiss}
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
