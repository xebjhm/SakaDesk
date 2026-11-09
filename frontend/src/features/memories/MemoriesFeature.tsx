import React, { useEffect, useState } from 'react';
import { MemoriesHome } from './MemoriesHome';
import { RecapEntry } from './recap/RecapEntry';
import { logMemoriesOpen, logMemoriesPage } from './memoriesLog';

/** Pages of the Memories router; later waves add more. */
export type MemoriesRoute =
    | { page: 'home' }
    | { page: 'recap'; year: number; memberPath?: string };

const HOME: MemoriesRoute = { page: 'home' };

interface MemoriesFeatureProps {
    service: string;
}

export const MemoriesFeature: React.FC<MemoriesFeatureProps> = ({ service }) => {
    // The route is tagged with its service so a service change falls back to home
    // on the same render (no flash of the old service's page).
    const [state, setState] = useState<{ service: string; route: MemoriesRoute }>({ service, route: HOME });
    const route = state.service === service ? state.route : HOME;

    const go = (next: MemoriesRoute) => {
        setState({ service, route: next });
        logMemoriesPage(next.page);
    };

    useEffect(() => {
        logMemoriesOpen(service);
    }, [service]);

    if (route.page === 'recap') {
        return (
            <RecapEntry
                service={service}
                year={route.year}
                memberPath={route.memberPath}
                onBack={() => go(HOME)}
            />
        );
    }
    return <MemoriesHome onOpenRecap={() => go({ page: 'recap', year: new Date().getFullYear() })} />;
};
