import { useEffect, useRef } from 'react';

/**
 * Returns `true` on the single render where `value` just transitioned to
 * `target` — optionally gated on it coming from a specific predecessor.
 *
 * Useful for "did this just flip" triggers like auto-expanding a panel
 * when transcription state goes `loading → done`, without firing when
 * the same `done` value is seen across re-renders.
 *
 *   const justCompleted = useJustBecame(transcriptionState, 'done', 'loading');
 *
 * @param value Current value observed.
 * @param target Value that signals "just happened".
 * @param from Optional predecessor; if set, the transition must be
 *   from this value. If omitted, any change into `target` counts.
 */
export function useJustBecame<T>(value: T, target: T, from?: T): boolean {
    const prev = useRef(value);
    const transitioned =
        value === target
        && prev.current !== value
        && (from === undefined || prev.current === from);
    useEffect(() => { prev.current = value; }, [value]);
    return transitioned;
}
