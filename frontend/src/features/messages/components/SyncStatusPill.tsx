import React from 'react';
import { useTranslation } from '../../../i18n';
import { Spinner } from '../../../design/primitives';
import { getSyncDetail } from '../../../utils/syncFormatters';
import { useSyncProgressStore } from '../../../shell/syncProgressStore';
import { ChatHeaderPill } from './ChatHeaderPill';

/** The chat header's "syncing" pill: the only chat element that re-renders on each progress tick. */
export const SyncStatusPill: React.FC<{ light: boolean }> = ({ light }) => {
    const { t } = useTranslation();
    const progress = useSyncProgressStore((s) => s.active);
    if (progress.state !== 'running') return null;
    return (
        <ChatHeaderPill light={light} tone="status">
            <Spinner size="sm" tone="current" decorative className="h-3 w-3" />
            <span>{getSyncDetail(progress, t, t('sync.syncing'))}</span>
        </ChatHeaderPill>
    );
};
