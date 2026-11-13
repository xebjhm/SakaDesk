// frontend/src/core/layout/ContentArea.tsx
import React, { useState } from 'react';
import { useAppStore, type FeatureId } from '../../store/appStore';
import { BlogsFeature } from '../../features/blogs';
import { MemoriesFeature } from '../../features/memories';
import { LiveInlineSyncView } from './InlineSyncView';
import { ContentSheet } from './ContentSheet';
import { FadeOnChange } from './FadeOnChange';
import { KeepMounted } from './KeepMounted';
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
 * Messages lays out its own member sidebar and chat sheet and stays mounted after its first visit
 * (hidden while another feature shows). Content fades in on every feature or service change.
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
    const syncCard = Boolean(isInitialSyncing) && initialSyncActive;
    const messagesShown = !syncCard && activeFeature === 'messages';
    // Messages mounts on its first visit and then stays, hidden while another feature shows (KeepMounted):
    // its room cache, scroll position and sidebar survive a trip to Blogs or Memories (UI health #11).
    const [messagesVisited, setMessagesVisited] = useState(messagesShown);
    if (messagesShown && !messagesVisited) setMessagesVisited(true);

    let other: React.ReactNode = null;
    // A queued first sync (another service is syncing) shows its card too.
    if (syncCard) {
        other = <ContentSheet><LiveInlineSyncView service={service} /></ContentSheet>;
    } else if (activeFeature === 'blogs') {
        other = <ContentSheet><BlogsFeature blogBackupEnabled={blogBackupEnabled} /></ContentSheet>;
    } else if (activeFeature === 'memories') {
        other = <ContentSheet><MemoriesFeature service={service} nickname={userNickname} /></ContentSheet>;
    } else if (activeFeature === 'news' || activeFeature === 'fanclub' || activeFeature === 'ai') {
        other = <ContentSheet><ComingSoon feature={activeFeature} /></ContentSheet>;
    }

    return (
        <FadeOnChange changeKey={`${service}:${activeFeature}`} className="relative flex h-full min-w-0 flex-1">
            {messagesVisited && <KeepMounted active={messagesShown}>{messagesContent}</KeepMounted>}
            {other}
        </FadeOnChange>
    );
};
