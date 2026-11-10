import React, { useMemo } from 'react';
import { useTranslation } from '../../../i18n';
import type { MemoriesRoute } from '../MemoriesFeature';
import { DayView } from '../day/DayView';
import { PageHeader } from '../shared/PageHeader';
import { jstDateFormat } from '../shared/jst';

export type DayRoute = Extract<MemoriesRoute, { page: 'day' }>;

interface DayPageProps {
    service: string;
    route: DayRoute;
    go: (next: MemoriesRoute) => void;
}

/**
 * 那一天 as its own page (`{page: 'day'}`): the page header titled with the JST date (localized)
 * over the core `DayView` of that date, filtered to `memberPath` when the route has one. Back
 * returns to the calendar month the day belongs to (with the same member filter) when the day
 * was opened from the calendar, else home.
 */
export const DayPage: React.FC<DayPageProps> = ({ service, route, go }) => {
    const { i18n } = useTranslation();
    const dateFormat = useMemo(() => jstDateFormat(i18n.language), [i18n.language]);
    const title = dateFormat.format(new Date(`${route.date}T00:00:00+09:00`));
    const back = () => go(route.from === 'calendar'
        ? { page: 'calendar', month: route.date.slice(0, 7), memberPath: route.memberPath }
        : { page: 'home' });
    return (
        <div data-testid="memories-page-day" data-service={service} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <PageHeader title={title} onBack={back} />
            <DayView service={service} date={route.date} memberPath={route.memberPath} />
        </div>
    );
};
