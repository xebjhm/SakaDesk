/**
 * Wait timing for every loading state (docs/design/DESIGN_SYSTEM.md, "Loading and waiting").
 *
 * - Nothing new for the first `motion.loading.reveal` ms (fast loads never flash).
 * - `slow` adds one line of "still working" copy; `verySlow` adds an explanation plus Cancel or progress.
 * - A shown indicator stays at least `minVisible` ms.
 *
 * The `ui_wait` breadcrumb (`logWait`) carries a surface code, a phase code and `wait_ms` only.
 */
import { useEffect, useRef, useState } from 'react';
import { clientLog } from '../utils/clientLog';
import { motion } from './tokens';

export type LoadingStage = 'hidden' | 'shown' | 'slow' | 'verySlow';
export type WaitPhase = 'slow' | 'very_slow' | 'timeout' | 'cancelled';

const { reveal, slow, verySlow, minVisible } = motion.loading;
const SURFACE_CODE = /^[a-z0-9_]{1,40}$/;

/** The stage a wait of `elapsedMs` is in. Pure. */
export function stageFor(elapsedMs: number): LoadingStage {
    if (elapsedMs >= verySlow) return 'verySlow';
    if (elapsedMs >= slow) return 'slow';
    if (elapsedMs >= reveal) return 'shown';
    return 'hidden';
}

/**
 * ms to hold a finished result so a shown indicator stays `minVisible`: 0 if `elapsedMs < reveal`
 * (the indicator never showed), else `max(0, reveal + minVisible - elapsedMs)`. Pure.
 */
export function settleDelay(elapsedMs: number): number {
    if (elapsedMs < reveal) return 0;
    return Math.max(0, reveal + minVisible - elapsedMs);
}

/**
 * `ui_wait` breadcrumb: `surface` (a code matching `^[a-z0-9_]{1,40}$`), `phase` and `wait_ms`
 * (rounded, never negative). A surface that is not a code is refused (no post; a development
 * warning). Never throws.
 */
export function logWait(surface: string, phase: WaitPhase, waitMs: number): void {
    if (!SURFACE_CODE.test(surface)) {
        if (import.meta.env.DEV) console.warn('[logWait] surface must be a code (^[a-z0-9_]{1,40}$); breadcrumb dropped');
        return;
    }
    try {
        clientLog('ui_wait', { surface, phase, wait_ms: Math.max(0, Math.round(waitMs)) });
    } catch {
        // A breadcrumb must never break the UI flow.
    }
}

interface StageState { stage: LoadingStage; waitMs: number }
const HIDDEN: StageState = { stage: 'hidden', waitMs: 0 };

/**
 * Stage clock for one wait. While `active`, `stage` steps `hidden` → `shown` (reveal) → `slow` →
 * `verySlow`; `waitMs` is the elapsed time when the stage last changed (it does not tick). Turning
 * `active` off resets to `hidden` / 0. `startedAt` (a `Date.now()` value) starts the clock in the
 * past. With `surface`, logs `ui_wait` once for `slow` and once for `very_slow` per wait.
 */
export function useLoadingStages(
    active: boolean,
    options: { surface?: string; startedAt?: number } = {},
): StageState {
    const { surface, startedAt } = options;
    const [state, setState] = useState<StageState>(HIDDEN);

    useEffect(() => {
        if (!active) {
            setState(HIDDEN);
            return undefined;
        }
        const start = startedAt ?? Date.now();
        const logged = new Set<WaitPhase>();
        const update = () => {
            const elapsed = Math.max(0, Date.now() - start);
            const stage = stageFor(elapsed);
            setState((prev) => (prev.stage === stage ? prev : { stage, waitMs: elapsed }));
            if (!surface) return;
            if (elapsed >= slow && !logged.has('slow')) {
                logged.add('slow');
                logWait(surface, 'slow', elapsed);
            }
            if (elapsed >= verySlow && !logged.has('very_slow')) {
                logged.add('very_slow');
                logWait(surface, 'very_slow', elapsed);
            }
        };
        update();
        const timers = [reveal, slow, verySlow]
            .map((boundary) => boundary - (Date.now() - start))
            .filter((delay) => delay > 0)
            .map((delay) => setTimeout(update, delay));
        return () => timers.forEach(clearTimeout);
    }, [active, surface, startedAt]);

    return active ? state : HIDDEN;
}

/**
 * true from `reveal` after `active` turns on, until `active` is off AND it has been visible for at
 * least `minVisible`. A wait shorter than `reveal` never shows. For indicators that do not gate
 * content (a top bar, a row spinner).
 */
export function useDelayedLoading(active: boolean): boolean {
    const [shown, setShown] = useState(false);
    const shownAt = useRef<number | null>(null);

    useEffect(() => {
        if (active) {
            if (shownAt.current !== null) return undefined; // still visible (re-armed during the hold)
            const timer = setTimeout(() => {
                shownAt.current = Date.now();
                setShown(true);
            }, reveal);
            return () => clearTimeout(timer);
        }
        if (shownAt.current === null) return undefined;
        const hide = () => {
            shownAt.current = null;
            setShown(false);
        };
        const remaining = minVisible - (Date.now() - shownAt.current);
        if (remaining <= 0) {
            hide();
            return undefined;
        }
        const timer = setTimeout(hide, remaining);
        return () => clearTimeout(timer);
    }, [active]);

    return shown;
}

/**
 * Keep-previous (the calendar pattern, generalised). While `loading`, returns the last ready
 * payload of the same `scope` (compared with `Object.is`) with `stale: true`; a new scope has
 * nothing to keep (`shown: null`). Once ready, returns `data` with `stale: false`. Only ready,
 * non-null data is remembered.
 */
export function useKeepPrevious<T>(
    data: T | null,
    options: { scope: unknown; loading: boolean },
): { shown: T | null; stale: boolean } {
    const { scope, loading } = options;
    const [kept, setKept] = useState<{ scope: unknown; data: T } | null>(null);

    if (!loading && data !== null && (kept === null || !Object.is(kept.scope, scope) || !Object.is(kept.data, data))) {
        // Render-phase update of this component's own state (React's "storing information from
        // previous renders" pattern): no extra effect pass, no stale frame.
        setKept({ scope, data });
    }

    if (!loading) return { shown: data, stale: false };
    if (kept !== null && Object.is(kept.scope, scope)) return { shown: kept.data, stale: true };
    return { shown: null, stale: false };
}
