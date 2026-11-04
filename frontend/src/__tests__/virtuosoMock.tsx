import React from 'react';
import type { ListRange } from 'react-virtuoso';

/** What the chat tests read back from the last rendered list. */
export const virtuosoCapture: { rangeChanged?: (range: ListRange) => void } = {};

interface FlatProps {
    data: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
    rangeChanged?: (range: ListRange) => void;
}

/**
 * jsdom has no layout, so the real list renders no rows. This stand-in renders every row
 * and captures `rangeChanged`. Use with:
 *   vi.mock('react-virtuoso', async () => (await import('<rel>/__tests__/virtuosoMock')).virtuosoMock);
 */
export const virtuosoMock = {
    Virtuoso: ({ data, itemContent, rangeChanged }: FlatProps) => {
        virtuosoCapture.rangeChanged = rangeChanged;
        return <div>{data.map((item, i) => <div key={i}>{itemContent(i, item)}</div>)}</div>;
    },
};
