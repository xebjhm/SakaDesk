import React, { useEffect, useState } from 'react';
import { MemoriesHome } from './MemoriesHome';
import { RecapEntry } from './recap/RecapEntry';
import { fetchRecapYears } from './recap/api';
import { defaultRecapYear, offeredRecapYears, recapAvailability } from './recap/availability';
import { logMemoriesOpen, logMemoriesPage, logRecapLoad } from './memoriesLog';

/** Pages of the Memories router; later waves add more. */
export type MemoriesRoute =
    | { page: 'home' }
    | { page: 'recap'; year: number; memberPath?: string };

const HOME: MemoriesRoute = { page: 'home' };

interface MemoriesFeatureProps {
    service: string;
    /** The fan's nickname for this service (`%%%` in her messages). */
    nickname?: string;
}

export const MemoriesFeature: React.FC<MemoriesFeatureProps> = ({ service, nickname }) => {
    // The route is tagged with its service so a service change falls back to home
    // on the same render (no flash of the old service's page).
    const [state, setState] = useState<{ service: string; route: MemoriesRoute }>({ service, route: HOME });
    const route = state.service === service ? state.route : HOME;

    const go = (next: MemoriesRoute) => {
        setState({ service, route: next });
        logMemoriesPage(next.page);
    };

    // The shelf of yearbooks (years with a recap), tagged with its service; null while unknown.
    const [shelf, setShelf] = useState<{ service: string; years: number[] | null }>({ service, years: null });
    const dataYears = shelf.service === service ? shelf.years : null;

    useEffect(() => {
        logMemoriesOpen(service);
        const controller = new AbortController();
        void fetchRecapYears(service, controller.signal).then((res) => {
            if (res.status === 'ok') {
                const years = Array.isArray(res.data.years) ? res.data.years.filter((y) => Number.isInteger(y)) : [];
                logRecapLoad('years', years.length ? 'ok' : 'empty', { count: years.length });
                setShelf({ service, years });
            } else if (res.status === 'timeout' || res.status === 'rejected' || res.status === 'failed') {
                // Unknown shelf: every year up to the newest open one stays offered.
                logRecapLoad('years', res.status, res.status === 'rejected' ? { error_code: res.httpStatus } : {});
            }
        });
        return () => controller.abort();
    }, [service]);

    // Unlocks are JST (Dec 1 opens the current year; from Jan 1 the year just ended comes first).
    const avail = recapAvailability();
    const offered = offeredRecapYears(avail, dataYears);
    const openYear = defaultRecapYear(avail, offered);

    if (route.page === 'recap') {
        return (
            <RecapEntry
                service={service}
                year={route.year}
                memberPath={route.memberPath}
                nickname={nickname}
                years={offered}
                onBack={() => go(HOME)}
            />
        );
    }
    return (
        <MemoriesHome
            recap={openYear === null ? null : { year: openYear, partial: avail.currentOpen && openYear === avail.year }}
            onOpenRecap={(year) => go({ page: 'recap', year })}
        />
    );
};
