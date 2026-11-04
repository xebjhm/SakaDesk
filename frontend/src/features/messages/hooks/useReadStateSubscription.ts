import { useEffect, useLayoutEffect, useRef } from 'react';
import { loadReadState, subscribeReadState } from '../readStateStore';
import type { ReadState } from '../readStateStore';

/**
 * Subscribe to read-state changes made outside the open chat (the popup-heard
 * bridge). `onAnyChange` fires for every path (sidebar refresh);
 * `onSelectedChanged` fires with the fresh state when the open chat changed.
 */
export function useReadStateSubscription(
    selectedGroupDir: string | undefined,
    onSelectedChanged: (state: ReadState) => void,
    onAnyChange: () => void,
): void {
    const ref = useRef({ selectedGroupDir, onSelectedChanged, onAnyChange });
    useLayoutEffect(() => {
        ref.current = { selectedGroupDir, onSelectedChanged, onAnyChange };
    });
    useEffect(() => subscribeReadState(path => {
        const cur = ref.current;
        cur.onAnyChange();
        if (path === cur.selectedGroupDir) cur.onSelectedChanged(loadReadState(path));
    }), []);
}
