// frontend/src/core/common/SyncProgressPanel.tsx
import React from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { cn } from '../../utils/classnames';
import { ProgressBar, Spinner } from '../../design/primitives';
import { useLoadingStages } from '../../design/loading';
import { formatSyncEta, formatSyncTime, formatSyncSpeedParts, getSyncDetail } from '../../utils/syncFormatters';
import type { SyncProgress } from '../../features/messages/MessagesFeature';

const PHASE_ORDER = ['scanning', 'discovering', 'syncing', 'downloading', 'complete'];
/**
 * Phases before the backend knows how much there is to do (`total` starts at 0 in `scanning`;
 * `''` before the first phase, `queued` while waiting in line). A later phase with `total = 0`
 * (nothing to sync or download, verify or repair) is real progress, not scanning.
 */
const SCAN_PHASES: ReadonlySet<string> = new Set(['', 'starting', 'scanning', 'discovering', 'queued']);

export interface SyncProgressPanelProps {
    progress: SyncProgress;
}

/**
 * The shared body of the sync dialog (brand) and the inline sync view (its group): count and
 * percent, the progress bar (`bg-expressive-progress`: aurora in brand, the title gradient in a
 * group, as `e4e4118`), three stat tiles, the detail row (accent) or the media warning (semantic
 * warning) while running, and the phase steps.
 *
 * Scanning (loading UX L6): while a running or queued sync has no total yet (a scan phase, see
 * `SCAN_PHASES`), the count row reads "getting ready" instead of "0 / 0 · 0 %" and the bar is
 * indeterminate; after 10 s of a running scan a line explains why (a queued sync's detail row
 * already explains its wait). Cancel already sits in the dialog footer and the inline view. A
 * running phase whose total stays 0 (verifying) shows its count alone over an indeterminate bar.
 */
export const SyncProgressPanel: React.FC<SyncProgressPanelProps> = ({ progress }) => {
    const { t, i18n } = useTranslation();
    const total = progress.total ?? 0;
    const scanning = (progress.state === 'running' || progress.state === 'queued')
        && total === 0
        && SCAN_PHASES.has(progress.phase ?? '');
    const { stage: scanStage } = useLoadingStages(scanning, { surface: 'sync_scan' });
    // A queued sync waits for another one: the detail row already says so (place in line), so
    // the "checking for new messages" explanation would be wrong there.
    const showScanExplanation = scanning && progress.state !== 'queued' && scanStage === 'verySlow';
    // A running phase with no total (verifying counts members with total 0): the count alone
    // over an indeterminate bar, never "N / 0 · 0 %".
    const unknownTotal = !scanning && progress.state === 'running' && total === 0;
    const countText = (progress.completed ?? 0).toLocaleString(i18n.language);
    const ratio = total > 0 ? (progress.completed || 0) / total : 0;
    const percent = Math.round(ratio * 100);
    const currentIndex = PHASE_ORDER.indexOf(progress.phase || '');
    const speed = formatSyncSpeedParts(progress.speed, progress.speed_unit || 'it');
    // Every tile is a number over a unit line (an empty unit keeps the height equal).
    const stats = [
        // Run elapsed (S2, spec 2026-11-10): it no longer resets at every phase.
        { key: 'elapsed', label: t('time.elapsed'), value: formatSyncTime(progress.run_elapsed_seconds ?? progress.elapsed_seconds), unit: '' },
        { key: 'eta', label: t('time.eta'), value: formatSyncEta(progress, t), unit: '' },
        { key: 'speed', label: t('time.speed'), value: speed.value, unit: speed.unit },
    ];
    const steps = [
        { phase: 'scanning', label: t('sync.scan') },
        { phase: 'syncing', label: t('sync.syncing') },
        { phase: 'downloading', label: t('sync.download') },
    ];

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
                {scanning ? (
                    <p className="text-small font-semibold text-secondary">{t('sync.preparing')}</p>
                ) : unknownTotal ? (
                    <p data-testid="sync-count" className="text-small font-semibold tabular-nums text-secondary">{countText}</p>
                ) : (
                    <div className="flex justify-between text-small font-semibold tabular-nums">
                        <span className="text-secondary">
                            {progress.completed?.toLocaleString(i18n.language) || 0} / {progress.total?.toLocaleString(i18n.language) || 0}
                        </span>
                        <span className="text-primary">{`${percent}%`}</span>
                    </div>
                )}
                {/* e4e4118: a 16 px light-grey track; fill = the pastel (dialog) or the title gradient (inline). */}
                <ProgressBar
                    value={scanning || unknownTotal ? null : ratio}
                    size="md"
                    label={t('sync.progress')}
                    valueText={scanning
                        ? undefined
                        : unknownTotal ? countText : `${progress.completed?.toLocaleString(i18n.language) || 0} / ${progress.total?.toLocaleString(i18n.language) || 0}`}
                    fillTestId="sync-progress-fill"
                />
                {showScanExplanation && (
                    <p className="text-small text-secondary">{t('sync.preparingVerySlow')}</p>
                )}
            </div>

            <div className="grid grid-cols-3 gap-4">
                {stats.map((s) => (
                    <div key={s.key} className="flex flex-col gap-1 rounded-lg bg-elevated p-3 text-center">
                        <span className="text-caption text-secondary">{s.label}</span>
                        <span className="font-mono text-title font-semibold tabular-nums text-primary">{s.value}</span>
                        <span className="min-h-4 text-caption text-secondary">{s.unit}</span>
                    </div>
                ))}
            </div>

            {/* Only while running: on completion the backend leaves phase_number at 3, and the
                "do not close" line (and the spinner) would make a finished sync look stuck. */}
            {(progress.state === 'running' || progress.state === 'queued') && (progress.state === 'running' && progress.phase_number === 3 ? (
                <div
                    data-testid="sync-media-warning"
                    className="flex items-center justify-center gap-2 rounded-lg border border-semantic-warning bg-semantic-warning-subtle px-4 py-3 text-semantic-warning"
                >
                    <Spinner size="sm" tone="current" decorative className="shrink-0" />
                    <span className="text-small font-semibold">
                        {t('sync.downloadingMedia')}
                        {(progress.failed ?? 0) > 0 && ` ${t('sync.filesFailed', { count: progress.failed })}`}
                    </span>
                </div>
            ) : (
                <div data-testid="sync-detail" className="flex items-center gap-2 rounded-lg bg-accent-subtle px-4 py-3">
                    <Spinner size="sm" tone="accent" decorative className="shrink-0" />
                    <span className="truncate text-small font-semibold text-primary">
                        {getSyncDetail(progress, t, t('sync.processing'))}
                        {progress.detail_extra && ` ${progress.detail_extra}`}
                    </span>
                </div>
            ))}

            <ol className="flex justify-center gap-6">
                {steps.map((step) => {
                    const isActive = progress.phase === step.phase || (step.phase === 'scanning' && progress.phase === 'discovering');
                    const isComplete = currentIndex > PHASE_ORDER.indexOf(step.phase);
                    return (
                        <li key={step.phase} aria-current={isActive ? 'step' : undefined} className="relative flex flex-col items-center gap-1">
                            <span
                                data-testid={`sync-step-dot-${step.phase}`}
                                aria-hidden="true"
                                className={cn(
                                    'flex h-3 w-3 items-center justify-center rounded-full transition-colors duration-fast ease-standard',
                                    isActive ? 'bg-accent ring-4 ring-accent-subtle' : isComplete ? 'bg-status-success' : 'bg-control-off',
                                )}
                            >
                                {isComplete && !isActive && <Check className="h-2 w-2 text-inverse" strokeWidth={4} />}
                            </span>
                            <span className={cn('text-caption', isActive ? 'font-semibold text-accent-strong' : 'text-secondary')}>{step.label}</span>
                            <span className="sr-only">{isActive ? t('sync.stepCurrent') : isComplete ? t('sync.stepDone') : t('sync.stepPending')}</span>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
};
