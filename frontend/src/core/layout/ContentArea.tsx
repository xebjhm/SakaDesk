// frontend/src/core/layout/ContentArea.tsx
import React from 'react';
import { useAppStore, type FeatureId } from '../../store/appStore';
import { BlogsFeature } from '../../features/blogs';
import { MemoriesFeature } from '../../features/memories';
import { LiveInlineSyncView } from './InlineSyncView';
import { ContentSheet } from './ContentSheet';
import { FadeOnChange } from './FadeOnChange';
import { useTranslation } from '../../i18n';
import { useSyncProgressStore } from '../../shell/syncProgressStore';
import { isSyncActive } from '../../utils/syncFormatters';

interface ContentAreaProps {
    service: string;
    messagesContent: React.ReactNode;
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
    isInitialSyncing,
    blogBackupEnabled,
    userNickname,
}) => {
    const activeFeature = useAppStore((s) => s.getActiveFeature(service));
    // A boolean slice: a progress tick re-renders the inline card only, never the feature beside it.
    const initialSyncActive = useSyncProgressStore((s) => isSyncActive(s.byService[service]));

    let content: React.ReactNode;
    // A queued first sync (another service is syncing) shows its card too.
    if (isInitialSyncing && initialSyncActive) {
        content = <ContentSheet><LiveInlineSyncView service={service} /></ContentSheet>;
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
