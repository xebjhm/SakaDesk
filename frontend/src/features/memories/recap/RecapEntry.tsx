import React from 'react';

interface RecapEntryProps {
    service: string;
    year: number;
    memberPath?: string;
    onBack: () => void;
}

/** Placeholder for the year recap entry; task R4 replaces it. */
export const RecapEntry: React.FC<RecapEntryProps> = () => <div data-testid="recap-entry" />;
