import { useRef, useCallback, useMemo, useEffect } from 'react';
import type { ListRange } from 'react-virtuoso';
import { persisted } from '../../../core/persistence/persisted';
import type { Timeline } from '../timeline/buildTimeline';

const STORAGE_KEY_PREFIX = 'sakadesk_scroll_';
const DEBOUNCE_MS = 500;

export interface UseChatScrollResult {
  /** Item index to pass to Virtuoso's initialTopMostItemIndex */
  initialTopMostItemIndex: number;
  /** Callback for Virtuoso's rangeChanged prop */
  handleRangeChanged: (range: ListRange) => void;
  /** Save the current position now (e.g. right before a room switch) */
  savePositionImmediate: () => void;
}

/**
 * ID-based scroll save/restore for the chat timeline.
 *
 * - Saves the top-most visible MESSAGE id to persisted app-state, 500 ms after the list
 *   stops moving. A letter on top saves the nearest message above it (below it at the very top).
 * - Which row is "top-most visible" is resolved one animation frame after `rangeChanged`, so
 *   the DOM matches the range: `topVisibleIndex(range)` skips rows hidden behind the sticky date
 *   header; without it the range start is used. A range is only resolved for the room that
 *   reported it.
 * - Restores by looking the saved id up in the timeline; a new room or an unknown id opens at the bottom.
 * - The last resolved position is also written on a room switch, on unmount, and (through the
 *   keepalive beacon) on pagehide / hidden.
 */
export function useChatScroll(
  memberId: string | number,
  timeline: Timeline,
  topVisibleIndex?: (range: ListRange) => number,
): UseChatScrollResult {
  const storageKey = `${STORAGE_KEY_PREFIX}${memberId}`;
  const keyRef = useRef(storageKey);
  // Updated during render: after a room switch commits, this already holds the new room.
  const latest = useRef({ storageKey, timeline, topVisibleIndex });
  latest.current = { storageKey, timeline, topVisibleIndex };
  /** The last reported range and the room it was reported for. */
  const pendingRangeRef = useRef<{ range: ListRange; key: string } | null>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topIdRef = useRef<number | null>(null);
  const lastSavedRef = useRef<{ key: string; id: number } | null>(null);

  const write = useCallback((key: string, beacon = false) => {
    const id = topIdRef.current;
    if (id === null) return;
    const last = lastSavedRef.current;
    if (last && last.key === key && last.id === id) return;
    if (beacon) persisted.setConvBeacon(key, { value: String(id) });
    else persisted.setConv(key, { value: String(id) });
    lastSavedRef.current = { key, id };
  }, []);

  /**
   * Turn the last reported range into the top visible message id (needs THIS room's DOM).
   * Between the new room's render and the passive room-switch effect, the rendered room
   * (`latest`) and the room writes go to (`keyRef`) differ. A range is only resolved when it
   * was reported for both: an old room's range resolved on the new timeline, or a new room's
   * range resolved early (pagehide flush, a lagging frame), would otherwise save a new-room
   * id under the old room's key.
   */
  const resolvePending = useCallback(() => {
    const pending = pendingRangeRef.current;
    pendingRangeRef.current = null;
    if (!pending) return;
    const { storageKey: currentKey, timeline: current, topVisibleIndex: resolve } = latest.current;
    if (pending.key !== currentKey || pending.key !== keyRef.current) return;
    const { range } = pending;
    const id = current.messageIdNear(resolve ? resolve(range) : range.startIndex);
    if (id !== null) topIdRef.current = id;
  }, []);

  const cancelScheduled = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Room switch: save the previous room's last resolved top message. Its pending range is
  // dropped: the DOM and the timeline already belong to the new room.
  useEffect(() => {
    if (keyRef.current === storageKey) return;
    cancelScheduled();
    pendingRangeRef.current = null;
    write(keyRef.current);
    keyRef.current = storageKey;
    topIdRef.current = null;
  }, [storageKey, cancelScheduled, write]);

  const initialTopMostItemIndex = useMemo(() => {
    const last = timeline.items.length - 1;
    if (last < 0) return 0;
    const savedId = persisted.getConv<{ value?: string }>(storageKey, {}).value ?? null;
    if (!savedId) return last; // New room -> bottom
    const index = timeline.indexOfMessage(Number(savedId));
    return index !== -1 ? index : last; // Not found -> bottom
  }, [storageKey, timeline]);

  const handleRangeChanged = useCallback((range: ListRange) => {
    pendingRangeRef.current = { range, key: latest.current.storageKey };
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      resolvePending();
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        write(keyRef.current);
      }, DEBOUNCE_MS);
    });
  }, [resolvePending, write]);

  const savePositionImmediate = useCallback(() => {
    cancelScheduled();
    resolvePending();
    write(keyRef.current);
  }, [cancelScheduled, resolvePending, write]);

  // Unmount: keep the last resolved position (the DOM is gone, so a pending range is dropped).
  useEffect(() => () => {
    cancelScheduled();
    pendingRangeRef.current = null;
    write(keyRef.current);
  }, [cancelScheduled, write]);

  // SD-FE-STATE-03: flush on pagehide/hidden through setConvBeacon, whose keepalive request
  // survives the JS context teardown on close (plain setConv's PATCH is abandoned).
  useEffect(() => {
    const flush = () => {
      cancelScheduled();
      resolvePending();
      write(keyRef.current, true);
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [cancelScheduled, resolvePending, write]);

  return { initialTopMostItemIndex, handleRangeChanged, savePositionImmediate };
}
