// frontend/src/core/layout/ContentArea.tsx
import React from 'react';
import { useAppStore, type FeatureId } from '../../store/appStore';
import { BlogsFeature } from '../../features/blogs';
import { InlineSyncView } from './InlineSyncView';
import { ContentSheet } from './ContentSheet';
import { FadeOnChange } from './FadeOnChange';
import { useTranslation } from '../../i18n';
import type { SyncProgress } from '../../features/messages/MessagesFeature';
import { isSyncActive } from '../../utils/syncFormatters';

interface ContentAreaProps {
    service: string;
    messagesContent: React.ReactNode;
    syncProgress?: SyncProgress;
    isInitialSyncing?: boolean;
    blogBackupEnabled?: boolean;
}

const ComingSoon: React.FC<{ feature: FeatureId }> = ({ feature }) => {
    const { t } = useTranslation();
    return (
        <div className="flex flex-1 items-center justify-center text-secondary">
            <div className="text-center">
                <p className="mb-2 text-title">{t(`features.${feature}`)}</p>
                <p className="text-small text-muted">{t('contentArea.comingSoon')}</p>
            </div>
        </div>
    );
};

/**
 * The area right of the feature rail, on the group canvas. Features sit on a ContentSheet;
 * messages lay out their own member sidebar (on the canvas) and chat sheet. Content fades
 * in on every feature or service change.
 */
export const ContentArea: React.FC<ContentAreaProps> = ({
    service,
    messagesContent,
    syncProgress,
    isInitialSyncing,
    blogBackupEnabled,
}) => {
    const { getActiveFeature } = useAppStore();
    const activeFeature = getActiveFeature(service);

    let content: React.ReactNode;
    // A queued first sync (another service is syncing) shows its card too.
    if (isInitialSyncing && isSyncActive(syncProgress)) {
        content = <ContentSheet><InlineSyncView service={service} syncProgress={syncProgress} /></ContentSheet>;
    } else if (activeFeature === 'blogs') {
        content = <ContentSheet><BlogsFeature blogBackupEnabled={blogBackupEnabled} /></ContentSheet>;
    } else if (activeFeature === 'news' || activeFeature === 'fanclub' || activeFeature === 'ai') {
        content = <ContentSheet><ComingSoon feature={activeFeature} /></ContentSheet>;
    } else {
        content = messagesContent;
    }

    return (
        <FadeOnChange changeKey={`${service}:${activeFeature}`} className="flex h-full min-w-0 flex-1">
            {content}
        </FadeOnChange>
    );
};
