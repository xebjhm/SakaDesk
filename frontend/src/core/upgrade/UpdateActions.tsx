import { Download, ArrowUpCircle, ExternalLink, RotateCcw } from 'lucide-react';
import { Button } from '../../design/primitives';
import { useTranslation } from '../../i18n';
import { useUpgradeStore, upgradeStage, openReleasePage } from './upgradeStore';

/**
 * The upgrade actions in Settings → Updates: the same stage as the rail's UpgradeIcon
 * (shared store), with explicit buttons. A version skipped on the rail is still offered
 * here. Renders nothing when SakaDesk is up to date.
 *
 * - available: Download update (or Open download page where in-place upgrade is unsupported)
 * - downloading: progress + Cancel download
 * - ready: Install now (SakaDesk closes and reopens)
 * - launching: Installing…
 * - error: the error + Try again
 */
export function UpdateActions() {
    const { t } = useTranslation();
    const versionInfo = useUpgradeStore((s) => s.versionInfo);
    const status = useUpgradeStore((s) => s.status);
    const dismissed = useUpgradeStore((s) => s.dismissed);
    const { startDownload, install, cancel, retry } = useUpgradeStore.getState();
    const stage = upgradeStage({ status, versionInfo, dismissed }, true);
    if (stage === 'hidden') return null;

    const version = status?.version || versionInfo?.latest_version || '';
    const percent = Math.round(status?.progress ?? 0);

    return (
        <div className="mt-3 flex flex-col gap-2" data-testid="update-actions">
            {stage === 'available' && (
                <div className="flex flex-wrap items-center gap-3">
                    <span className="text-small text-primary">{`${t('update.updateAvailable')} v${version}`}</span>
                    {versionInfo?.upgrade_supported ? (
                        <Button variant="primary" size="sm" onClick={() => { void startDownload(); }}>
                            <Download className="h-4 w-4" />
                            {t('update.download')}
                        </Button>
                    ) : (
                        <Button variant="secondary" size="sm" onClick={() => openReleasePage(versionInfo?.release_url)}>
                            <ExternalLink className="h-4 w-4" />
                            {t('update.openReleasePage')}
                        </Button>
                    )}
                </div>
            )}

            {stage === 'downloading' && (
                <>
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="text-small text-primary">{`${t('update.downloading', { version })} ${percent}%`}</span>
                        <Button variant="secondary" size="sm" onClick={() => { void cancel(); }}>
                            {t('update.cancelDownload')}
                        </Button>
                    </div>
                    <div
                        role="progressbar"
                        aria-label={t('update.downloading', { version })}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                        className="h-2 overflow-hidden rounded-full bg-sunken"
                    >
                        <div
                            className="h-full rounded-full bg-expressive-progress transition-all duration-base ease-standard motion-reduce:transition-none"
                            style={{ width: `${percent}%` }}
                        />
                    </div>
                </>
            )}

            {stage === 'ready' && (
                <div className="flex flex-wrap items-center gap-3">
                    <span className="text-small text-primary">{t('update.readyToInstall', { version })}</span>
                    <Button variant="primary" size="sm" onClick={() => { void install(); }}>
                        <ArrowUpCircle className="h-4 w-4" />
                        {t('update.installNow')}
                    </Button>
                    <span className="basis-full text-caption text-muted">{t('update.installHint')}</span>
                </div>
            )}

            {stage === 'launching' && (
                <span role="status" className="text-small text-secondary">{t('update.installing')}</span>
            )}

            {stage === 'error' && (
                <div className="flex flex-wrap items-center gap-3">
                    <span className="text-small text-semantic-danger">
                        {`${t('update.upgradeFailed')} ${status?.error ?? ''}`.trim()}
                    </span>
                    <Button variant="secondary" size="sm" onClick={() => { void retry(); }}>
                        <RotateCcw className="h-4 w-4" />
                        {t('update.retry')}
                    </Button>
                </div>
            )}
        </div>
    );
}
