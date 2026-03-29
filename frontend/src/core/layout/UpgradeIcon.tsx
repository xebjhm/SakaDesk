import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, RotateCcw, X, AlertCircle } from 'lucide-react';
import { cn } from '../../utils/classnames';
import { useTranslation } from '../../i18n';

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
 */
export function UpgradeIcon() {
    const { t } = useTranslation();
    const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
    const [upgradeStatus, setUpgradeStatus] = useState<UpgradeStatus | null>(null);
    const [dismissed, setDismissed] = useState(false);
    const [isPolling, setIsPolling] = useState(false);
    const [autoDownload, setAutoDownload] = useState(true);
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
            .catch(() => {});
    }, []);

    // Check version on mount and periodically
    useEffect(() => {
        const checkVersion = async () => {
            try {
                const res = await fetch('/api/version');
                if (res.ok) {
                    const data: VersionInfo = await res.json();
                    setVersionInfo(data);

                    const dismissedVersion = localStorage.getItem('sakadesk_dismissed_update');
                    if (dismissedVersion === data.latest_version) {
                        setDismissed(true);
                    } else if (data.update_available) {
                        setDismissed(false);
                    }
                }
            } catch {
                // Silent fail — will retry next interval
            }
        };

        checkVersion();
        const interval = setInterval(checkVersion, 60 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

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
    }, [autoDownload, stage, versionInfo?.upgrade_supported]);

    // Poll upgrade status while downloading/launching
    useEffect(() => {
        if (!isPolling) return;

        const poll = async () => {
            try {
                const res = await fetch('/api/version/upgrade/status');
                if (res.ok) {
                    const status: UpgradeStatus = await res.json();
                    setUpgradeStatus(status);
                    if (status.state === 'ready' || status.state === 'error' || status.state === 'idle') {
                        setIsPolling(false);
                    }
                }
            } catch {
                // Continue polling
            }
        };

        const interval = setInterval(poll, 500);
        return () => clearInterval(interval);
    }, [isPolling]);

    const handleStartDownload = useCallback(async () => {
        try {
            const res = await fetch('/api/version/upgrade/start', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setIsPolling(true);
                setUpgradeStatus({ state: 'downloading', progress: 0, error: null, version: data.version });
            } else {
                setUpgradeStatus({ state: 'error', progress: 0, error: data.error, version: null });
            }
        } catch {
            setUpgradeStatus({ state: 'error', progress: 0, error: t('update.upgradeFailed'), version: null });
        }
    }, [t]);

    const handleInstall = useCallback(async () => {
        try {
            const res = await fetch('/api/version/upgrade/install', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setUpgradeStatus(prev => prev ? { ...prev, state: 'launching' } : null);
            } else {
                setUpgradeStatus({ state: 'error', progress: 100, error: data.error, version: upgradeStatus?.version || null });
            }
        } catch {
            setUpgradeStatus({ state: 'error', progress: 100, error: t('update.upgradeFailed'), version: upgradeStatus?.version || null });
        }
    }, [upgradeStatus?.version, t]);

    const handleDismiss = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (stage === 'available' && versionInfo?.latest_version) {
            localStorage.setItem('sakadesk_dismissed_update', versionInfo.latest_version);
            setDismissed(true);
        }
        if (stage === 'error') {
            // Cancel on error dismiss
            fetch('/api/version/upgrade/cancel', { method: 'POST' }).catch(() => {});
            setUpgradeStatus(null);
        }
    }, [stage, versionInfo?.latest_version]);

    const handleCancel = useCallback(async () => {
        try {
            await fetch('/api/version/upgrade/cancel', { method: 'POST' });
        } catch {
            // Ignore
        }
        setUpgradeStatus(null);
        setIsPolling(false);
        autoDownloadTriggered.current = false;
    }, []);

    // For non-Windows: open release page in browser
    const handleOpenRelease = useCallback(() => {
        if (versionInfo?.release_url) {
            window.open(versionInfo.release_url, '_blank');
        }
    }, [versionInfo?.release_url]);

    if (stage === 'hidden') return null;

    const progress = upgradeStatus?.progress ?? 0;
    const version = upgradeStatus?.version || versionInfo?.latest_version || '';

    // SVG progress ring constants
    const ringRadius = 18;
    const ringCircumference = 2 * Math.PI * ringRadius;
    const ringOffset = ringCircumference - (progress / 100) * ringCircumference;

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
                handleCancel();
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
                    "w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200",
                    stage === 'error'
                        ? "bg-red-100 text-red-600 hover:bg-red-200"
                        : stage === 'ready'
                        ? "bg-green-100 text-green-600 hover:bg-green-200"
                        : "bg-blue-100 text-blue-600 hover:bg-blue-200"
                )}
                title={tooltip}
            >
                {/* Progress ring for downloading state */}
                {stage === 'downloading' && (
                    <svg className="absolute inset-0 w-11 h-11 -rotate-90" viewBox="0 0 44 44">
                        <circle
                            cx="22" cy="22" r={ringRadius}
                            fill="none" stroke="currentColor" strokeWidth="2.5"
                            strokeDasharray={ringCircumference}
                            strokeDashoffset={ringOffset}
                            className="text-blue-500 transition-[stroke-dashoffset] duration-300"
                            strokeLinecap="round"
                        />
                    </svg>
                )}

                {/* Icon */}
                {stage === 'error' ? (
                    <AlertCircle className="w-5 h-5" />
                ) : stage === 'ready' || stage === 'launching' ? (
                    <RotateCcw className={cn("w-5 h-5", stage === 'launching' && "animate-spin")} />
                ) : (
                    <Download className="w-5 h-5" />
                )}

                {/* Notification dot */}
                {(stage === 'available' || stage === 'ready') && (
                    <span className={cn(
                        "absolute top-0 right-0 w-3 h-3 rounded-full border-2 border-gray-50",
                        stage === 'available' ? "bg-blue-500" : "bg-green-500"
                    )} />
                )}
            </button>

            {/* Dismiss button on hover for available/error stages */}
            {(stage === 'available' || stage === 'error') && (
                <button
                    onClick={handleDismiss}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gray-400 text-white items-center justify-center hidden group-hover:flex hover:bg-gray-500 transition-colors"
                    title={stage === 'error' ? t('common.cancel') : t('update.skipVersion')}
                >
                    <X className="w-2.5 h-2.5" />
                </button>
            )}
        </div>
    );
}
