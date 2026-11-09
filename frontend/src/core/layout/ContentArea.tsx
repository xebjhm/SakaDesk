// frontend/src/core/layout/ContentArea.tsx
import React from 'react';
import { useAppStore, type FeatureId } from '../../store/appStore';
import { BlogsFeature } from '../../features/blogs';
import { MemoriesFeature } from '../../features/memories';
import { InlineSyncView } from './InlineSyncView';
import { ContentSheet } from './ContentSheet';
import { FadeOnChange } from './FadeOnChange';
import { useTranslation } from '../../i18n';
import type { SyncProgress } from '../../features/messages/MessagesFeature';

interface ContentAreaProps {
    service: string;
    messagesContent: React.ReactNode;
    syncProgress?: SyncProgress;
    isInitialSyncing?: boolean;
    blogBackupEnabled?: boolean;
    /** The fan's nickname for this service. */
    userNickname?: string;
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
    userNickname,
}) => {
    const { getActiveFeature } = useAppStore();
    const activeFeature = getActiveFeature(service);

    let content: React.ReactNode;
    if (isInitialSyncing && syncProgress?.state === 'running') {
        content = <ContentSheet><InlineSyncView service={service} syncProgress={syncProgress} /></ContentSheet>;
    } else if (activeFeature === 'blogs') {
        content = <ContentSheet><BlogsFeature blogBackupEnabled={blogBackupEnabled} /></ContentSheet>;
    } else if (activeFeature === 'memories') {
        content = <ContentSheet><MemoriesFeature service={service} nickname={userNickname} /></ContentSheet>;
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
