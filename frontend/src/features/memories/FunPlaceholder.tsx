import React, { useMemo } from 'react';
import { useTranslation } from '../../i18n';
import type { MemoriesRoute } from './MemoriesFeature';
import { PageHeader } from './shared/PageHeader';
import { jstDateFormat } from './shared/jst';

/** A fun-wave page route that has no screen yet. */
export type FunRoute = Extract<MemoriesRoute, { page: 'radio' | 'gacha' | 'calendar' | 'day' }>;

const TITLE_KEYS: Record<Exclude<FunRoute['page'], 'day'>, string> = {
    radio: 'memories.home.radio',
    gacha: 'memories.home.gacha',
    calendar: 'memories.home.calendar',
};

interface FunPlaceholderProps {
    service: string;
    route: FunRoute;
    go: (next: MemoriesRoute) => void;
}

/**
 * The stand-in for a fun-wave page until its task draws it (F8 radio, F9 gacha, F10 calendar and
 * the day): the page frame, its serif title and back. A day opened from the calendar goes back to
 * the calendar; everything else goes home. The day's title is its JST date, localized.
 */
export const FunPlaceholder: React.FC<FunPlaceholderProps> = ({ service, route, go }) => {
    const { t, i18n } = useTranslation();
    const dateFormat = useMemo(() => jstDateFormat(i18n.language), [i18n.language]);
    const title = route.page === 'day'
        ? dateFormat.format(new Date(`${route.date}T00:00:00+09:00`))
        : t(TITLE_KEYS[route.page]);
    const back = () => go(route.page === 'day' && route.from === 'calendar' ? { page: 'calendar' } : { page: 'home' });
    return (
        <div data-testid={`memories-page-${route.page}`} data-service={service} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <PageHeader title={title} onBack={back} />
        </div>
    );
};
