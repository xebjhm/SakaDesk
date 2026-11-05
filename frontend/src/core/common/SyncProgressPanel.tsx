// frontend/src/core/common/SyncProgressPanel.tsx
import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { cn } from '../../utils/classnames';
import { formatSyncTime, formatSyncSpeedParts, getSyncDetail } from '../../utils/syncFormatters';
import type { SyncProgress } from '../../features/messages/MessagesFeature';

const PHASE_ORDER = ['scanning', 'discovering', 'syncing', 'downloading', 'complete'];

export interface SyncProgressPanelProps {
    progress: SyncProgress;
}

/**
 * The shared body of the sync dialog and the inline sync view
 * (docs/superpowers/specs/2026-11-05-d2d-entry-design.md, decisions 9–11): count and percent,
 * the progress bar, three stat tiles, the detail row while running, and the phase steps.
 */
export const SyncProgressPanel: React.FC<SyncProgressPanelProps> = ({ progress }) => {
    const { t } = useTranslation();
    const total = progress.total ?? 0;
    const ratio = total > 0 ? (progress.completed || 0) / total : 0;
    const percent = Math.round(ratio * 100);
    const currentIndex = PHASE_ORDER.indexOf(progress.phase || '');
    const speed = formatSyncSpeedParts(progress.speed, progress.speed_unit || 'it');
    // Every tile is a number over a unit line (an empty unit keeps the height equal).
    const stats = [
        { key: 'elapsed', label: t('time.elapsed'), value: formatSyncTime(progress.elapsed_seconds), unit: '' },
        { key: 'eta', label: t('time.eta'), value: progress.eta_seconds ? formatSyncTime(progress.eta_seconds) : '--:--', unit: '' },
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
                <div className="flex justify-between text-small font-semibold tabular-nums">
                    <span className="text-secondary">
                        {progress.completed?.toLocaleString() || 0} / {progress.total?.toLocaleString() || 0}
                    </span>
                    <span className="text-primary">{`${percent}%`}</span>
                </div>
                <div
                    role="progressbar"
                    aria-label={t('sync.progress')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-valuetext={`${progress.completed?.toLocaleString() || 0} / ${progress.total?.toLocaleString() || 0}`}
                    className="h-2 overflow-hidden rounded-pill bg-sunken"
                >
                    <div
                        className="h-full rounded-pill bg-group-accent transition-all duration-base ease-standard motion-reduce:transition-none"
                        style={{ width: `${ratio * 100}%` }}
                    />
                </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
                {stats.map((s) => (
                    <div key={s.key} className="flex flex-col gap-1 rounded-card bg-sunken p-3 text-center">
                        <span className="text-caption text-secondary">{s.label}</span>
                        <span className="font-mono text-title font-semibold tabular-nums text-primary">{s.value}</span>
                        <span className="min-h-4 text-caption text-secondary">{s.unit}</span>
                    </div>
                ))}
            </div>

            {/* Only while running: on completion the backend leaves phase_number at 3, and the
                "do not close" line (and the spinner) would make a finished sync look stuck. */}
            {progress.state === 'running' && (progress.phase_number === 3 ? (
                <div className="flex items-center justify-center gap-2 rounded-card bg-sunken px-4 py-3">
                    <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin text-status-warning motion-reduce:animate-none" />
                    <span className="text-small font-semibold text-primary">{t('sync.downloadingMedia')}</span>
                </div>
            ) : (
                <div className="flex items-center gap-2 rounded-card bg-group-subtle px-4 py-3">
                    <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin text-secondary motion-reduce:animate-none" />
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
                        <li key={step.phase} aria-current={isActive ? 'step' : undefined} className="flex flex-col items-center gap-1">
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'flex h-3 w-3 items-center justify-center rounded-pill transition-colors duration-fast ease-standard',
                                    isActive ? 'bg-group-accent shadow-group-glow' : isComplete ? 'bg-status-success' : 'bg-control-off',
                                )}
                            >
                                {isComplete && !isActive && <Check className="h-2 w-2 text-inverse" strokeWidth={4} />}
                            </span>
                            <span className={cn('text-caption', isActive ? 'font-semibold text-group-strong' : 'text-secondary')}>{step.label}</span>
                            <span className="sr-only">{isActive ? t('sync.stepCurrent') : isComplete ? t('sync.stepDone') : t('sync.stepPending')}</span>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
};
