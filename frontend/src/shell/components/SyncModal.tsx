// frontend/src/shell/components/SyncModal.tsx
import React, { useState } from 'react';
import { AlertTriangle, Image as ImageIcon, Mic, Video } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { Button, Modal } from '../../design/primitives';
import { groupScopeStyle } from '../../design/groupScope';
import { serviceIdToGroupId } from '../../config/colors';
import { cn, formatDateTime } from '../../utils/classnames';
import { getServiceById } from '../../data/services';
import { getSyncPhaseName, getSyncUnitLabel } from '../../utils/syncFormatters';
import { SyncProgressPanel } from '../../core/common/SyncProgressPanel';
import type { SyncProgress } from '../../features/messages/MessagesFeature';
import type { SequentialSyncInfo } from '../hooks/useSync';

interface SyncModalProps {
    syncProgress: SyncProgress;
    sequentialSyncInfo?: SequentialSyncInfo | null;
    onClose?: () => void;
    /** SD-FE-GAP-B-08: cancel a running sync so the user is never locked to a
        non-terminating spinner (e.g. a hung verify). */
    onCancel?: () => void;
}

/** The blocking sync dialog (spec D2d decisions 4, 6, 9–11, 17, 19): not dismissible; Done or Cancel. */
export const SyncModal: React.FC<SyncModalProps> = ({ syncProgress, sequentialSyncInfo, onClose, onCancel }) => {
    const { t } = useTranslation();
    // The service a sequential sync last scoped this dialog to. Kept until the dialog closes, so
    // Complete stays in that service's colours after the sequence info is cleared.
    const sequentialService = sequentialSyncInfo?.currentService ?? null;
    const [lastScopedService, setLastScopedService] = useState(sequentialService);
    if (sequentialService && sequentialService !== lastScopedService) setLastScopedService(sequentialService);
    const scopedService = sequentialService ?? lastScopedService;
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

    const footer = (syncProgress.state === 'complete' || syncProgress.state === 'error') && onClose
        ? <Button variant="secondary" onClick={onClose}>{t('common.done')}</Button>
        // SD-FE-GAP-B-08: while running, offer a Cancel so the user is never trapped by a spinner.
        : syncProgress.state === 'running' && onCancel
            ? <Button variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>
            : undefined;

    return (
        <Modal
            isOpen
            onClose={onClose ?? (() => {})}
            title={title}
            dismissible={false}
            logId="sync"
            className="max-w-lg"
            footer={footer}
        >
            <div
                className="flex flex-col gap-5"
                style={scopedService ? groupScopeStyle(serviceIdToGroupId(scopedService)) : undefined}
            >
                {sequentialSyncInfo && sequentialSyncInfo.total > 1 && (
                    <div className="flex items-center justify-center gap-2">
                        {Array.from({ length: sequentialSyncInfo.total }, (_, i) => (
                            <span
                                key={i}
                                aria-hidden="true"
                                className={cn(
                                    'h-1 rounded-pill transition-all duration-base ease-standard motion-reduce:transition-none',
                                    i < sequentialSyncInfo.currentIndex ? 'w-6 bg-group-accent'
                                        : i === sequentialSyncInfo.currentIndex ? 'w-10 bg-group-accent'
                                            : 'w-6 bg-control-off',
                                )}
                            />
                        ))}
                        <span className="ml-2 text-caption font-semibold text-secondary">
                            {serviceName} ({sequentialSyncInfo.currentIndex + 1}/{sequentialSyncInfo.total})
                        </span>
                    </div>
                )}

                <p className="text-small text-secondary">{subtitle}</p>

                {result && (
                    <div className="flex flex-col gap-2 text-small text-secondary">
                        <p>
                            {result.missing === 0 && unresolved === 0
                                ? t('settings.verifyNoGaps')
                                : t('settings.verifySummary', {
                                    checked: result.checked,
                                    repaired: result.repaired,
                                    stillMissing: result.still_missing,
                                })}
                        </p>
                        {unresolved > 0 && (
                            <div className="flex flex-col rounded-card bg-sunken">
                                <p className="flex items-center gap-2 px-4 py-3 font-semibold text-primary">
                                    <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-status-warning" />
                                    {t('settings.verifyUnresolved', { count: unresolved })}
                                </p>
                                {(result.unresolved_items?.length ?? 0) > 0 && (
                                    <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto px-2 pb-2">
                                        {result.unresolved_items!.map((it, i) => {
                                            const Icon = it.media_type === 'video' ? Video : it.media_type === 'voice' ? Mic : ImageIcon;
                                            return (
                                                <li key={i} className="flex items-center gap-2 rounded-pill px-2 py-1">
                                                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-secondary" />
                                                    <span className="flex-1 truncate text-primary">{it.member}</span>
                                                    <span className="shrink-0 tabular-nums text-secondary">
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
