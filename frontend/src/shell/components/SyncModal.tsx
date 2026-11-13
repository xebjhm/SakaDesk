// frontend/src/shell/components/SyncModal.tsx
import React from 'react';
import { AlertTriangle, Download, Image as ImageIcon, Mic, Video } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { Button, Modal } from '../../design/primitives';
import { useGroupMarker } from '../../design/useGroupMarker';
import { cn, formatDateTime } from '../../utils/classnames';
import { getServiceById } from '../../data/services';
import { getSyncPhaseName, getSyncUnitLabel, isSyncActive } from '../../utils/syncFormatters';
import { SyncProgressPanel } from '../../core/common/SyncProgressPanel';
import type { SyncProgress } from '../../features/messages/MessagesFeature';
import type { SequentialSyncInfo } from '../hooks/useSync';
import { useSyncProgressStore } from '../syncProgressStore';

export interface SyncModalProps {
    syncProgress: SyncProgress;
    sequentialSyncInfo?: SequentialSyncInfo | null;
    onClose?: () => void;
    /** SD-FE-GAP-B-08: cancel a running sync so the user is never locked to a
        non-terminating spinner (e.g. a hung verify). */
    onCancel?: () => void;
}

/** One service's step in a sequential sync: a group marker (spec section 4 "rows are markers"; decision D5). */
const SyncStepBar: React.FC<{ serviceId: string; state: 'done' | 'current' | 'pending' }> = ({ serviceId, state }) => {
    const marker = useGroupMarker(serviceId, 'sync_row');
    return (
        <span
            data-testid={`sync-step-${serviceId}`}
            aria-hidden="true"
            style={marker}
            className={cn(
                'h-1 rounded-full transition-all duration-base ease-standard motion-reduce:transition-none',
                state === 'pending' ? 'w-6 bg-control-off' : state === 'current' ? 'w-10 bg-accent' : 'w-6 bg-accent',
            )}
        />
    );
};

/** The service being synced and its place in the sequence, in that group's colour. */
const SyncServiceChip: React.FC<{ serviceId: string; label: string }> = ({ serviceId, label }) => {
    const marker = useGroupMarker(serviceId, 'sync_row');
    return (
        <span data-testid="sync-service-chip" style={marker} className="ml-2 inline-flex items-center gap-1 text-caption font-semibold">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
            <span lang="ja" className="text-accent-strong">{label}</span>
        </span>
    );
};

/**
 * The blocking sync dialog: a brand dialog (spec section 4) whose sequential step row names each
 * group as a marker (decision D5). Not dismissible; Done or Cancel (D2d decisions 4, 6, 9-11, 17, 19).
 */
export const SyncModal: React.FC<SyncModalProps> = ({ syncProgress, sequentialSyncInfo, onClose, onCancel }) => {
    const { t } = useTranslation();
    const isComplete = syncProgress.phase === 'complete';
    const title = isComplete
        ? t('sync.complete')
        : t('sync.phase', { number: syncProgress.phase_number || 1, name: getSyncPhaseName(syncProgress, t) });
    const subtitle = isComplete
        ? t('sync.syncComplete')
        : syncProgress.total
            ? `${syncProgress.total.toLocaleString()} ${getSyncUnitLabel(syncProgress, t)}`
            : t('sync.pleaseWait');
    const serviceName = sequentialSyncInfo
        ? getServiceById(sequentialSyncInfo.currentService)?.displayName ?? sequentialSyncInfo.currentService
        : null;
    const result = syncProgress.state === 'complete' ? syncProgress.result : null;
    const unresolved = result?.unresolved ?? 0;
    const rejected = result?.rejected ?? 0;

    const footer = (syncProgress.state === 'complete' || syncProgress.state === 'error') && onClose
        ? <Button variant="secondary" onClick={onClose}>{t('common.done')}</Button>
        // SD-FE-GAP-B-08: while running, offer a Cancel so the user is never trapped by a spinner.
        : isSyncActive(syncProgress) && onCancel
            ? <Button variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>
            : undefined;

    return (
        <Modal
            isOpen
            onClose={onClose ?? (() => {})}
            scope="brand"
            title={title}
            icon={<Download />}
            dismissible={false}
            logId="sync"
            className="max-w-lg"
            footer={footer}
        >
            <div className="flex flex-col gap-5">
                {sequentialSyncInfo && sequentialSyncInfo.total > 1 && (
                    <div className="flex items-center justify-center gap-2">
                        {sequentialSyncInfo.services.map((serviceId, i) => (
                            <SyncStepBar
                                key={serviceId}
                                serviceId={serviceId}
                                state={i < sequentialSyncInfo.currentIndex ? 'done' : i === sequentialSyncInfo.currentIndex ? 'current' : 'pending'}
                            />
                        ))}
                        <SyncServiceChip
                            serviceId={sequentialSyncInfo.currentService}
                            label={`${serviceName} (${sequentialSyncInfo.currentIndex + 1}/${sequentialSyncInfo.total})`}
                        />
                    </div>
                )}

                <p className="text-small text-secondary">{subtitle}</p>

                {result && (
                    <div className="flex flex-col gap-2 text-small text-secondary">
                        <p>
                            {result.missing === 0 && unresolved === 0 && rejected === 0
                                ? t('settings.verifyNoGaps')
                                : t('settings.verifySummary', {
                                    checked: result.checked,
                                    repaired: result.repaired,
                                    stillMissing: result.still_missing,
                                })}
                        </p>
                        {rejected > 0 && (
                            <p data-testid="sync-rejected" className="flex items-center gap-2 text-semantic-warning">
                                <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
                                {t('settings.verifyRejected', { count: rejected })}
                            </p>
                        )}
                        {/* e4e4118: warning-tinted border, heading bg and text, icons in the warning hue. */}
                        {unresolved > 0 && (
                            <div data-testid="sync-unresolved" className="flex flex-col overflow-hidden rounded-lg border border-semantic-warning">
                                <p className="flex items-center gap-2 bg-semantic-warning-subtle px-4 py-3 font-semibold text-semantic-warning">
                                    <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
                                    {t('settings.verifyUnresolved', { count: unresolved })}
                                </p>
                                {(result.unresolved_items?.length ?? 0) > 0 && (
                                    <ul className="flex max-h-44 flex-col divide-y divide-subtle overflow-y-auto">
                                        {result.unresolved_items!.map((it, i) => {
                                            const Icon = it.media_type === 'video' ? Video : it.media_type === 'voice' ? Mic : ImageIcon;
                                            return (
                                                <li key={i} className="flex items-center gap-2 px-4 py-2">
                                                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-semantic-warning" />
                                                    <span lang="ja" className="flex-1 truncate text-secondary">{it.member}</span>
                                                    <span className="shrink-0 tabular-nums text-muted">
                                                        {it.timestamp ? formatDateTime(it.timestamp) : ''}
                                                    </span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <SyncProgressPanel progress={syncProgress} />
            </div>
        </Modal>
    );
};

/** The sync dialog fed from the progress store: it, not App, re-renders on each tick. */
export const LiveSyncModal: React.FC<Omit<SyncModalProps, 'syncProgress'>> = (props) => {
    const syncProgress = useSyncProgressStore((s) => s.active);
    return <SyncModal {...props} syncProgress={syncProgress} />;
};
