import React from 'react';
import type { ListRange } from 'react-virtuoso';

/** What the chat tests read back from the last rendered list. */
export const virtuosoCapture: {
    rangeChanged?: (range: ListRange) => void;
    /** Every `scrollToIndex` location passed to the last lists' refs, in order. */
    scrollToIndex: unknown[];
} = { scrollToIndex: [] };

/** Clear the capture; call in `beforeEach` so a test never sees a previous test's list. */
export function resetVirtuosoCapture(): void {
    virtuosoCapture.rangeChanged = undefined;
    virtuosoCapture.scrollToIndex = [];
}

const captureScrollToIndex = (location: unknown): void => {
    virtuosoCapture.scrollToIndex.push(location);
};

interface FlatProps {
    data: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
    rangeChanged?: (range: ListRange) => void;
}

interface GroupedProps {
    groupCounts: number[];
    groupContent: (groupIndex: number) => React.ReactNode;
    itemContent: (index: number, groupIndex: number) => React.ReactNode;
    components?: { Footer?: React.ComponentType };
    rangeChanged?: (range: ListRange) => void;
}

/**
 * jsdom has no layout, so the real list renders no rows. These stand-ins (`Virtuoso`, and
 * `GroupedVirtuoso`, which renders each group header before its rows) render every row,
 * render `components.Footer` after the rows, capture `rangeChanged` and `scrollToIndex` locations, and expose stub `scrollTo` / `scrollBy` on their ref.
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
        scrollToIndex: captureScrollToIndex,
        scrollTo: () => {},
        scrollBy: () => {},
    }));
    return <div>{data.map((item, i) => <div key={i}>{itemContent(i, item)}</div>)}</div>;
});
Virtuoso.displayName = 'VirtuosoMock';

const GroupedVirtuoso = React.forwardRef<unknown, GroupedProps>(({ groupCounts, groupContent, itemContent, components, rangeChanged }, ref) => {
    virtuosoCapture.rangeChanged = rangeChanged;
    React.useImperativeHandle(ref, () => ({
        scrollToIndex: captureScrollToIndex,
        scrollTo: () => {},
        scrollBy: () => {},
    }));
    const rows: React.ReactNode[] = [];
    let index = 0;
    groupCounts.forEach((count, g) => {
        rows.push(<div key={`group-${g}`}>{groupContent(g)}</div>);
        for (let k = 0; k < count; k += 1, index += 1) rows.push(<div key={`item-${index}`}>{itemContent(index, g)}</div>);
    });
    const Footer = components?.Footer;
    return <div>{rows}{Footer ? <Footer /> : null}</div>;
});
GroupedVirtuoso.displayName = 'GroupedVirtuosoMock';

export const virtuosoMock = { Virtuoso, GroupedVirtuoso };
