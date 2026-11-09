// frontend/src/core/layout/InlineSyncView.tsx
import React from 'react';
import { Download } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { Card } from '../../design/primitives';
import { groupTokens } from '../../design/tokens';
import { groupScopeStyle } from '../../design/groupScope';
import { serviceIdToGroupId } from '../../config/colors';
import { cn } from '../../utils/classnames';
import { getSyncPhaseName, getSyncUnitLabel } from '../../utils/syncFormatters';
import { SyncProgressPanel } from '../common/SyncProgressPanel';
import type { SyncProgress } from '../../features/messages/MessagesFeature';

interface InlineSyncViewProps {
    service: string;
    syncProgress: SyncProgress;
}

/**
 * A newly added service's first sync, inside the content sheet: a card scoped to the service
 * (its group context, D2d decision 13) with its official banner (like the chat header) and the
 * shared panel, whose bar is that group's title gradient (`e4e4118`).
 */
export const InlineSyncView: React.FC<InlineSyncViewProps> = ({ service, syncProgress }) => {
    const { t } = useTranslation();
    const groupId = serviceIdToGroupId(service);
    const isLight = groupTokens[groupId].official.headerStyle === 'light';
    const isComplete = syncProgress.phase === 'complete';
    const title = isComplete
        ? t('sync.complete')
        : t('sync.phase', { number: syncProgress.phase_number || 1, name: getSyncPhaseName(syncProgress, t) });
    const subtitle = isComplete
        ? t('sync.syncComplete')
        : syncProgress.total
            ? `${syncProgress.total.toLocaleString()} ${getSyncUnitLabel(syncProgress, t)}`
            : t('sync.pleaseWait');

    return (
        <div className="flex flex-1 items-center justify-center p-6">
            <Card className="flex w-full max-w-lg flex-col overflow-hidden" style={groupScopeStyle(groupId)}>
                <div
                    data-testid="inline-sync-banner"
                    className={cn('flex items-center gap-3 px-6 py-4', isLight ? 'bg-card text-group-title' : 'bg-group-title text-inverse')}
                >
                    <span
                        aria-hidden="true"
                        className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-pill', isLight ? 'bg-accent-subtle' : 'bg-viewer-control')}
                    >
                        <Download className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                        {/* The light banner's title uses the official colour; its low contrast is a property of that colour. */}
                        <h3 className="truncate text-title font-semibold">{title}</h3>
                        <p className={cn('text-small', isLight && 'text-secondary')}>{subtitle}</p>
                    </div>
                </div>
                {isLight && <div className="h-1 shrink-0 bg-group-title-bar" />}
                <div className="p-6">
                    <SyncProgressPanel progress={syncProgress} />
                </div>
            </Card>
        </div>
    );
};
