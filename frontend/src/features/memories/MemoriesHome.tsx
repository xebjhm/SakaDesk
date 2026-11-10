import React from 'react';
import { RecapHubCard, type RecapCardState } from './home/RecapHubCard';

export type { RecapCardState } from './home/RecapHubCard';

interface MemoriesHomeProps {
    recap: RecapCardState;
    onOpenRecap: (year: number) => void;
    onRetry: () => void;
}

/** Temporary hub with one entry card (the year recap); the core wave replaces it. */
export const MemoriesHome: React.FC<MemoriesHomeProps> = ({ recap, onOpenRecap, onRetry }) => (
    <div data-testid="memories-home" className="flex flex-1 items-center justify-center p-6">
        <RecapHubCard recap={recap} onOpenRecap={onOpenRecap} onRetry={onRetry} />
    </div>
);
