import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GroupedVirtuoso, type GroupedVirtuosoHandle, type IndexLocationWithAlign, type ListRange } from 'react-virtuoso';

const GROUPS = 200;
const PER_GROUP = 10;

interface ProbeWindow extends Window {
    __probe?: { ranges: ListRange[]; scrollToIndex: (location: IndexLocationWithAlign) => void };
}

/**
 * Dev-only harness for e2e/probe/grouped-virtuoso.spec.ts: a fixed-size GroupedVirtuoso
 * (200 groups x 10 rows, rows 60 px, headers 40 px, 600 px tall). `?initial=N` sets
 * initialTopMostItemIndex. Exposes `window.__probe`.
 */
export const TimelineProbe: React.FC = () => {
    const ref = useRef<GroupedVirtuosoHandle>(null);
    const ranges = useRef<ListRange[]>([]);
    const [initial] = useState(() => {
        const value = new URLSearchParams(window.location.search).get('initial');
        return value === null ? undefined : Number(value);
    });
    const groupCounts = useMemo(() => Array.from({ length: GROUPS }, () => PER_GROUP), []);
    useEffect(() => {
        (window as ProbeWindow).__probe = {
            ranges: ranges.current,
            scrollToIndex: (location) => ref.current?.scrollToIndex(location),
        };
    }, []);
    return (
        <div style={{ height: 600, width: 400 }}>
            <GroupedVirtuoso
                ref={ref}
                style={{ height: '100%' }}
                groupCounts={groupCounts}
                // Omit the prop rather than pass `undefined`: Virtuoso forwards any present key, and
                // `initialTopMostItemIndex={undefined}` throws "reading 'index'" (4.18.1).
                {...(initial === undefined ? {} : { initialTopMostItemIndex: initial })}
                groupContent={(g) => <div id={`group-${g}`} style={{ height: 40 }}>Group {g}</div>}
                itemContent={(i) => <div id={`row-${i}`} style={{ height: 60 }}>Item {i}</div>}
                rangeChanged={(range) => { ranges.current.push(range); }}
            />
        </div>
    );
};
