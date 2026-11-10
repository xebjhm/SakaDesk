import React, { useEffect, useState } from 'react';
import { MemoriesHome, type RecapCardState } from './MemoriesHome';
import { RecapEntry } from './recap/RecapEntry';
import { fetchRecapYears } from './recap/api';
import { defaultRecapYear, offeredRecapYears, recapAvailability } from './recap/availability';
import { logMemoriesOpen, logMemoriesPage, logRecapLoad } from './memoriesLog';

/** Pages of the Memories router; later waves add more. */
export type MemoriesRoute =
    | { page: 'home' }
    | { page: 'recap'; year: number; memberPath?: string };

const HOME: MemoriesRoute = { page: 'home' };

type ShelfState = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; years: number[] };
const LOADING: ShelfState = { status: 'loading' };

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

    // The shelf of yearbooks (years with a recap), tagged with its service. Loading,
    // failed and loaded (possibly empty) are kept apart: the hub never offers a year
    // it has not confirmed.
    // Tagged with its service and attempt so a service change or a retry reads as loading
    // on the same render.
    const [attempt, setAttempt] = useState(0);
    const [shelf, setShelf] = useState<{ service: string; attempt: number; state: ShelfState }>({
        service, attempt, state: LOADING,
    });
    const shelfState: ShelfState = shelf.service === service && shelf.attempt === attempt ? shelf.state : LOADING;

    useEffect(() => {
        logMemoriesOpen(service);
    }, [service]);

    useEffect(() => {
        const controller = new AbortController();
        void fetchRecapYears(service, controller.signal).then((res) => {
            if (res.status === 'ok') {
                const years = Array.isArray(res.data.years) ? res.data.years.filter((y) => Number.isInteger(y)) : [];
                logRecapLoad('years', years.length ? 'ok' : 'empty', { count: years.length });
                setShelf({ service, attempt, state: { status: 'ready', years } });
            } else if (res.status === 'timeout' || res.status === 'rejected' || res.status === 'failed') {
                logRecapLoad('years', res.status, res.status === 'rejected' ? { error_code: res.httpStatus } : {});
                setShelf({ service, attempt, state: { status: 'failed' } });
            }
        });
        return () => controller.abort();
    }, [service, attempt]);

    // Unlocks are JST (Dec 1 opens the current year; from Jan 1 the year just ended comes first).
    const avail = recapAvailability();
    const dataYears = shelfState.status === 'ready' ? shelfState.years : null;
    // Only the recap page uses the unknown-shelf fallback (every year up to the newest open one).
    const offered = offeredRecapYears(avail, dataYears);
    const openYear = defaultRecapYear(avail, offered);
    let card: RecapCardState;
    if (shelfState.status === 'loading') card = { kind: 'loading' };
    else if (shelfState.status === 'failed') card = { kind: 'failed' };
    else if (openYear === null) card = { kind: 'closed' };
    else card = { kind: 'open', year: openYear, partial: avail.currentOpen && openYear === avail.year };

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
            recap={card}
            onOpenRecap={(year) => go({ page: 'recap', year })}
            onRetry={() => setAttempt((n) => n + 1)}
        />
    );
};
