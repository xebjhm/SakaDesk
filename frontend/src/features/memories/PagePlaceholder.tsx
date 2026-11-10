import React from 'react';
import { useTranslation } from '../../i18n';
import type { CorePageProps } from './MemoriesFeature';
import { PageHeader } from './shared/PageHeader';

const TITLE_KEY = {
    onThisDay: 'memories.onThisDay.title',
    album: 'memories.album.title',
    memoir: 'memories.memoir.title',
    favorites: 'memories.favorites.title',
} as const;

/**
 * A core page before its screen task lands: the page header (back returns home) over an empty
 * pane. Each screen task (C8–C11) replaces its route with the real page, which receives the
 * same `service`, `route` and `go`.
 */
export const PagePlaceholder: React.FC<CorePageProps> = ({ service, route, go }) => {
    const { t } = useTranslation();
    return (
        <div data-testid={`memories-page-${route.page}`} data-service={service} className="flex min-h-0 flex-1 flex-col">
            <PageHeader title={t(TITLE_KEY[route.page])} onBack={() => go({ page: 'home' })} />
            <div className="min-h-0 flex-1 overflow-y-auto" />
        </div>
    );
};
