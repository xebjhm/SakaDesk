import React from 'react';
import type { ListRange } from 'react-virtuoso';

/** What the chat tests read back from the last rendered list. */
export const virtuosoCapture: { rangeChanged?: (range: ListRange) => void } = {};

/** Clear the capture; call in `beforeEach` so a test never sees a previous test's list. */
export function resetVirtuosoCapture(): void {
    virtuosoCapture.rangeChanged = undefined;
}

interface FlatProps {
    data: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
    rangeChanged?: (range: ListRange) => void;
}

/**
 * jsdom has no layout, so the real list renders no rows. This stand-in renders every row,
 * captures `rangeChanged` and exposes stub `scrollToIndex` / `scrollTo` / `scrollBy` on its ref.
 *
 * It does NOT simulate `followOutput`, `initialTopMostItemIndex`, `scrollerRef` or row heights
 * (so no virtualisation, measurement or scroll position). Those are locked by the e2e specs
 * (`e2e/timeline-scroll.spec.ts`).
 *
 * Use with:
 *   vi.mock('react-virtuoso', async () => (await import('<rel>/__tests__/virtuosoMock')).virtuosoMock);
 */
const Virtuoso = React.forwardRef<unknown, FlatProps>(({ data, itemContent, rangeChanged }, ref) => {
    virtuosoCapture.rangeChanged = rangeChanged;
    React.useImperativeHandle(ref, () => ({
        scrollToIndex: () => {},
        scrollTo: () => {},
        scrollBy: () => {},
    }));
    return <div>{data.map((item, i) => <div key={i}>{itemContent(i, item)}</div>)}</div>;
});
Virtuoso.displayName = 'VirtuosoMock';

export const virtuosoMock = { Virtuoso };
