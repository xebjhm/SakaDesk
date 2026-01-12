import { useState, useEffect } from 'react';
import { Download, X, ExternalLink } from 'lucide-react';

interface VersionInfo {
    current_version: string;
    latest_version: string | null;
    update_available: boolean;
    release_url: string | null;
    release_notes: string | null;
    error: string | null;
}

interface UpdateBannerProps {
    onDismiss?: () => void;
}

export function UpdateBanner({ onDismiss }: UpdateBannerProps) {
    const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
    const [dismissed, setDismissed] = useState(false);
    const [checking, setChecking] = useState(true);

    useEffect(() => {
        // Check if user has dismissed this version update
        const dismissedVersion = localStorage.getItem('hakodesk_dismissed_update');

        const checkVersion = async () => {
            try {
                const res = await fetch('/api/version');
                if (res.ok) {
                    const data: VersionInfo = await res.json();
                    setVersionInfo(data);

                    // If user dismissed this specific version, don't show
                    if (dismissedVersion === data.latest_version) {
                        setDismissed(true);
                    }
                }
            } catch {
                // Silent fail - version check is not critical
            } finally {
                setChecking(false);
            }
        };

        checkVersion();
    }, []);

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

    // Don't render if checking, dismissed, no update, or error
    if (checking || dismissed || !versionInfo?.update_available) {
        return null;
    }

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
                <button
                    onClick={handleDownload}
                    className="flex items-center gap-1.5 px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors"
                >
                    <ExternalLink className="w-4 h-4" />
                    Download
                </button>
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
