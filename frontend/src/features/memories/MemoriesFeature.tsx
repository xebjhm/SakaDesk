import React, { useEffect, useRef, useState } from 'react';
import { MemoriesHome, type RecapCardState } from './MemoriesHome';
import { RecapEntry } from './recap/RecapEntry';
import { fetchRecapYears } from './recap/api';
import { defaultRecapYear, offeredRecapYears, recapAvailability } from './recap/availability';
import { logMemoriesOpen, logMemoriesPage, logRecapLoad } from './memoriesLog';
import { OnThisDayPage } from './onThisDay/OnThisDayPage';
import { AlbumPage } from './album/AlbumPage';
import { FavoritesPage } from './favorites/FavoritesPage';
import { MemoirPage } from './memoir/MemoirPage';
import { NicknameProvider } from './shared/useNickname';
import { FunPlaceholder } from './FunPlaceholder';
import { RadioPage } from './radio/RadioPage';
import { GachaPage } from './gacha/GachaPage';

/** Pages of the Memories router (the core pages, then the fun wave's). */
export type MemoriesRoute =
    | { page: 'home' }
    | { page: 'recap'; year: number; memberPath?: string }
    /** `monthDay` is `MM-DD`; `year` set = the detail (A) of that year. */
    | { page: 'onThisDay'; monthDay?: string; year?: number }
    | { page: 'album'; memberPath?: string }
    | { page: 'memoir'; memberPath?: string; tab?: 'binder' | 'timeline' | 'names' | 'day24' }
    | { page: 'favorites'; memberPath?: string }
    | { page: 'radio'; memberPath?: string }
    | { page: 'gacha' }
    /** `month` is `YYYY-MM` (JST). */
    | { page: 'calendar'; month?: string; memberPath?: string }
    /** `date` is `YYYY-MM-DD` (JST); `from: 'calendar'` makes back return to the calendar. */
    | { page: 'day'; date: string; from?: 'calendar' };

/** A core page's route (the four pages added by the core wave). */
export type CoreRoute = Extract<MemoriesRoute, { page: 'onThisDay' | 'album' | 'memoir' | 'favorites' }>;

/** What every core page receives from the router. */
export interface CorePageProps {
    service: string;
    route: CoreRoute;
    go: (next: MemoriesRoute) => void;
}

const HOME: MemoriesRoute = { page: 'home' };

type ShelfState = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; years: number[] };
const LOADING: ShelfState = { status: 'loading' };

interface MemoriesFeatureProps {
    service: string;
    /** The fan's nickname for this service (`%%%` in her messages). */
    nickname?: string;
    /** The page to open on first render (a deep link); a service change still returns home. */
    initialRoute?: MemoriesRoute;
}

export const MemoriesFeature: React.FC<MemoriesFeatureProps> = ({ service, nickname, initialRoute }) => {
    // The route is tagged with its service so a service change falls back to home
    // on the same render (no flash of the old service's page).
    const [state, setState] = useState<{ service: string; route: MemoriesRoute }>(() => ({ service, route: initialRoute ?? HOME }));
    // Re-tag on a service change (React's set-state-during-render pattern), so switching back
    // to the earlier service does not restore its old page.
    if (state.service !== service) setState({ service, route: HOME });
    const route = state.service === service ? state.route : HOME;

    // A deep link opens on its page without a `go`: log it like one.
    const initialPage = useRef(initialRoute?.page);
    useEffect(() => {
        if (initialPage.current && initialPage.current !== 'home') logMemoriesPage(initialPage.current);
    }, []);

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
            } else if (res.status !== 'aborted') {
                // A `skipped` poll (the same request already in flight) is a failure here too: the
                // card offers a retry rather than spinning forever. `aborted` is our own cleanup.
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

    let page: React.ReactNode;
    if (route.page === 'recap') {
        page = (
            <RecapEntry
                service={service}
                year={route.year}
                memberPath={route.memberPath}
                nickname={nickname}
                years={offered}
                onBack={() => go(HOME)}
            />
        );
    } else if (route.page === 'home') {
        page = (
            <MemoriesHome
                service={service}
                recap={card}
                onOpenRecap={(year) => go({ page: 'recap', year })}
                onRetry={() => setAttempt((n) => n + 1)}
                go={go}
            />
        );
    } else if (route.page === 'onThisDay') {
        page = <OnThisDayPage service={service} route={route} go={go} />;
    } else if (route.page === 'album') {
        page = <AlbumPage service={service} route={route} go={go} />;
    } else if (route.page === 'favorites') {
        page = <FavoritesPage service={service} route={route} go={go} />;
    } else if (route.page === 'radio') {
        page = <RadioPage service={service} route={route} go={go} />;
    } else if (route.page === 'gacha') {
        page = <GachaPage service={service} go={go} />;
    } else if (route.page === 'calendar' || route.page === 'day') {
        page = <FunPlaceholder service={service} route={route} go={go} />;
    } else {
        page = <MemoirPage service={service} route={route} go={go} />;
    }
    return <NicknameProvider nickname={nickname}>{page}</NicknameProvider>;
};
