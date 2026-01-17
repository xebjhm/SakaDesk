import { useState, useEffect, useCallback } from 'react';
import { Download, X, ExternalLink, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';

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

interface UpdateBannerProps {
    onDismiss?: () => void;
}

export function UpdateBanner({ onDismiss }: UpdateBannerProps) {
    const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
    const [dismissed, setDismissed] = useState(false);
    const [checking, setChecking] = useState(true);
    const [upgradeStatus, setUpgradeStatus] = useState<UpgradeStatus | null>(null);
    const [isUpgrading, setIsUpgrading] = useState(false);

    // Check version on mount
    useEffect(() => {
        const dismissedVersion = localStorage.getItem('hakodesk_dismissed_update');

        const checkVersion = async () => {
            try {
                const res = await fetch('/api/version');
                if (res.ok) {
                    const data: VersionInfo = await res.json();
                    setVersionInfo(data);

                    if (dismissedVersion === data.latest_version) {
                        setDismissed(true);
                    }
                }
            } catch {
                // Silent fail
            } finally {
                setChecking(false);
            }
        };

        checkVersion();
    }, []);

    // Poll upgrade status when upgrading
    useEffect(() => {
        if (!isUpgrading) return;

        const pollStatus = async () => {
            try {
                const res = await fetch('/api/version/upgrade/status');
                if (res.ok) {
                    const status: UpgradeStatus = await res.json();
                    setUpgradeStatus(status);

                    // Stop polling if done or error
                    if (status.state === 'ready' || status.state === 'error' || status.state === 'idle') {
                        setIsUpgrading(false);
                    }
                }
            } catch {
                // Continue polling
            }
        };

        const interval = setInterval(pollStatus, 500);
        return () => clearInterval(interval);
    }, [isUpgrading]);

    const handleDismiss = () => {
        if (versionInfo?.latest_version) {
            localStorage.setItem('hakodesk_dismissed_update', versionInfo.latest_version);
        }
        setDismissed(true);
        onDismiss?.();
    };

    const handleDownload = () => {
        if (versionInfo?.release_url) {
            window.open(versionInfo.release_url, '_blank');
        }
    };

    const handleStartUpgrade = useCallback(async () => {
        setIsUpgrading(true);
        try {
            const res = await fetch('/api/version/upgrade/start', { method: 'POST' });
            const data = await res.json();
            if (!data.success) {
                setUpgradeStatus({
                    state: 'error',
                    progress: 0,
                    error: data.error,
                    version: null,
                });
                setIsUpgrading(false);
            }
        } catch (e) {
            setUpgradeStatus({
                state: 'error',
                progress: 0,
                error: 'Failed to start upgrade',
                version: null,
            });
            setIsUpgrading(false);
        }
    }, []);

    const handleLaunchUpgrade = useCallback(async () => {
        try {
            const res = await fetch('/api/version/upgrade/launch', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setUpgradeStatus(prev => prev ? { ...prev, state: 'launching' } : null);
                // Show message to close app
            } else {
                setUpgradeStatus({
                    state: 'error',
                    progress: 100,
                    error: data.error,
                    version: upgradeStatus?.version || null,
                });
            }
        } catch (e) {
            setUpgradeStatus({
                state: 'error',
                progress: 100,
                error: 'Failed to launch upgrade',
                version: upgradeStatus?.version || null,
            });
        }
    }, [upgradeStatus?.version]);

    const handleCancelUpgrade = useCallback(async () => {
        try {
            await fetch('/api/version/upgrade/cancel', { method: 'POST' });
        } catch {
            // Ignore
        }
        setUpgradeStatus(null);
        setIsUpgrading(false);
    }, []);

    // Don't render if checking, dismissed, no update, or error
    if (checking || dismissed || !versionInfo?.update_available) {
        return null;
    }

    // Render upgrade progress if upgrading
    if (upgradeStatus && upgradeStatus.state !== 'idle') {
        return (
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-4 py-2 shadow-lg">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 flex-1">
                        {upgradeStatus.state === 'downloading' && (
                            <>
                                <RefreshCw className="w-5 h-5 shrink-0 animate-spin" />
                                <div className="flex-1">
                                    <div className="text-sm font-medium">
                                        Downloading v{upgradeStatus.version}...
                                    </div>
                                    <div className="mt-1 h-1.5 bg-white/30 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-white transition-all duration-300"
                                            style={{ width: `${upgradeStatus.progress}%` }}
                                        />
                                    </div>
                                </div>
                            </>
                        )}

                        {upgradeStatus.state === 'ready' && (
                            <>
                                <CheckCircle className="w-5 h-5 shrink-0" />
                                <div className="text-sm">
                                    <span className="font-medium">Ready to install v{upgradeStatus.version}</span>
                                </div>
                            </>
                        )}

                        {upgradeStatus.state === 'launching' && (
                            <>
                                <RefreshCw className="w-5 h-5 shrink-0 animate-spin" />
                                <div className="text-sm">
                                    <span className="font-medium">Installing...</span>
                                    <span className="ml-2 opacity-90">Close the app to complete upgrade</span>
                                </div>
                            </>
                        )}

                        {upgradeStatus.state === 'error' && (
                            <>
                                <AlertCircle className="w-5 h-5 shrink-0" />
                                <div className="text-sm">
                                    <span className="font-medium">Upgrade failed:</span>
                                    <span className="ml-2 opacity-90">{upgradeStatus.error}</span>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        {upgradeStatus.state === 'ready' && (
                            <button
                                onClick={handleLaunchUpgrade}
                                className="flex items-center gap-1.5 px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors"
                            >
                                Install Now
                            </button>
                        )}

                        {(upgradeStatus.state === 'downloading' || upgradeStatus.state === 'error') && (
                            <button
                                onClick={handleCancelUpgrade}
                                className="p-1 hover:bg-white/20 rounded-full transition-colors"
                                title="Cancel"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // Default update available banner
    return (
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-4 py-2 flex items-center justify-between gap-4 shadow-lg">
            <div className="flex items-center gap-3">
                <Download className="w-5 h-5 shrink-0" />
                <div className="text-sm">
                    <span className="font-medium">Update available!</span>
                    <span className="ml-2 opacity-90">
                        v{versionInfo.current_version} → v{versionInfo.latest_version}
                    </span>
                </div>
            </div>

            <div className="flex items-center gap-2">
                {versionInfo.upgrade_supported ? (
                    <button
                        onClick={handleStartUpgrade}
                        className="flex items-center gap-1.5 px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors"
                    >
                        <Download className="w-4 h-4" />
                        Upgrade Now
                    </button>
                ) : (
                    <button
                        onClick={handleDownload}
                        className="flex items-center gap-1.5 px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors"
                    >
                        <ExternalLink className="w-4 h-4" />
                        Download
                    </button>
                )}
                <button
                    onClick={handleDismiss}
                    className="p-1 hover:bg-white/20 rounded-full transition-colors"
                    title="Dismiss"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
