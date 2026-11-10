import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { AlbumMonthPayload } from '../types';

/** A month's grid loads once its band is within this of the scroll viewport (one screen). */
export const LOAD_MARGIN = '100% 0px';
/** A month's grid stays mounted while its band is within this (two screens); further away it is a placeholder. */
export const LIVE_MARGIN = '200% 0px';
/** After a ribbon jump or drag, loading resumes this long after the last scroll event. */
export const SETTLE_MS = 150;
/**
 * Month grids fetched at once. The first open used to fire one request per band within a screen
 * (six to eight), which the backend answered all together after seconds; two at a time, in the
 * order the bands were asked for (the top one first), the first grid arrives on its own.
 */
export const MAX_IN_FLIGHT = 2;

type MonthSet = ReadonlySet<string>;

/** `prev` with `month` added or removed; `prev` itself when nothing changes (no re-render). */
function toggled(prev: MonthSet, month: string, on: boolean): MonthSet {
    if (prev.has(month) === on) return prev;
    const next = new Set(prev);
    if (on) next.add(month); else next.delete(month);
    return next;
}

const monthOf = (e: IntersectionObserverEntry) => e.target.getAttribute('data-month');

export interface AlbumWindow {
    /** Registers a month band (`data-month`) with the observers; null on unmount. */
    registerRef: (month: string, el: HTMLElement | null) => void;
    /** The month's grid may be fetched now. */
    isRequested: (month: string, index: number) => boolean;
    /** The month's grid may be mounted (it is within `LIVE_MARGIN`). */
    isLive: (month: string) => boolean;
    /** Month payloads fetched so far: a band that comes back remounts from here, without a refetch. */
    cache: ReadonlyMap<string, AlbumMonthPayload>;
    onLoaded: (month: string, data: AlbumMonthPayload) => void;
    /** The month's request finished (ready or error). */
    onSettled: (month: string) => void;
    /** Scroll instantly to a month (ribbon click, key or drag); loading waits for the scroll to settle. */
    jump: (month: string) => void;
}

/**
 * Lazy loading and windowing of the album's month bands inside the scroll container `root`.
 *
 * With `IntersectionObserver`:
 * - a band within {@link LOAD_MARGIN} is requested (its grid fetched once, then kept in `cache`);
 * - a band within {@link LIVE_MARGIN} is live (its grid mounted); outside it the band is a
 *   placeholder of its measured height, so memory stays bounded however far one scrolls;
 * - a {@link AlbumWindow.jump} scrolls instantly and suspends requests until no scroll event has
 *   come for {@link SETTLE_MS}; then only the bands near the viewport at that moment are
 *   requested, so a scrub across the whole ribbon fetches only where it ends. Until those bands
 *   settle, the target is re-aligned after each load (their heights change).
 *
 * - at most {@link MAX_IN_FLIGHT} grids are fetched at once, in the order they were asked for;
 *   the newest month (the top band) is asked for on mount, so the first grid comes first.
 *
 * Without it, every band is live and the months load one after another in list order.
 * State changes only when a band enters or leaves a margin, so scrolling does not re-render.
 */
export function useAlbumWindow(months: string[], root: RefObject<HTMLElement>): AlbumWindow {
    const lazy = typeof IntersectionObserver !== 'undefined';
    const [requested, setRequested] = useState<MonthSet>(() => new Set());
    const [live, setLive] = useState<MonthSet>(() => new Set());
    const [settled, setSettled] = useState<MonthSet>(() => new Set());
    const [cache, setCache] = useState<ReadonlyMap<string, AlbumMonthPayload>>(() => new Map());
    const elements = useRef(new Map<string, HTMLElement>());
    const observers = useRef<IntersectionObserver[]>([]);
    const near = useRef(new Set<string>());
    const suspended = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // The jump target to keep aligned, and the bands whose loads may still move it.
    const pending = useRef<{ month: string; waiting: Set<string> } | null>(null);
    const cacheRef = useRef(cache);
    cacheRef.current = cache;
    const settledRef = useRef(settled);
    settledRef.current = settled;

    // Months in the order they were first asked for (append-only): the queue of MAX_IN_FLIGHT.
    const order = useRef<string[]>([]);
    // Months whose fetch was granted a slot (see the grants below).
    const started = useRef(new Set<string>());
    const request = useCallback((add: Iterable<string>) => {
        const list = [...add];
        if (!list.length) return;
        for (const m of list) if (!order.current.includes(m)) order.current.push(m);
        setRequested((prev) => (list.every((m) => prev.has(m)) ? prev : new Set([...prev, ...list])));
    }, []);

    const scrollTo = useCallback((month: string) => {
        elements.current.get(month)?.scrollIntoView({ block: 'start', behavior: 'auto' });
    }, []);

    const settle = useCallback(() => {
        timer.current = null;
        suspended.current = false;
        const now = [...near.current];
        if (pending.current) {
            pending.current.waiting = new Set(now.filter((m) => !cacheRef.current.has(m)));
            if (!pending.current.waiting.size) pending.current = null;
        }
        request(now);
    }, [request]);

    const armSettle = useCallback(() => {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(settle, SETTLE_MS);
    }, [settle]);

    useEffect(() => {
        if (!lazy || typeof IntersectionObserver === 'undefined') return undefined;
        const loadIo = new IntersectionObserver((entries) => {
            const entered: string[] = [];
            for (const e of entries) {
                const month = monthOf(e);
                if (month === null) continue;
                if (e.isIntersecting) { near.current.add(month); entered.push(month); } else near.current.delete(month);
            }
            if (!suspended.current) request(entered);
        }, { root: root.current, rootMargin: LOAD_MARGIN });
        const liveIo = new IntersectionObserver((entries) => {
            for (const e of entries) {
                const month = monthOf(e);
                if (month !== null) setLive((prev) => toggled(prev, month, e.isIntersecting));
            }
        }, { root: root.current, rootMargin: LIVE_MARGIN });
        observers.current = [loadIo, liveIo];
        elements.current.forEach((el) => { loadIo.observe(el); liveIo.observe(el); });
        const scroller = root.current;
        const onScroll = () => { if (suspended.current) armSettle(); };
        scroller?.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            loadIo.disconnect();
            liveIo.disconnect();
            observers.current = [];
            scroller?.removeEventListener('scroll', onScroll);
            if (timer.current !== null) clearTimeout(timer.current);
        };
    }, [lazy, root, request, armSettle]);

    // The newest month (the band at the top) is asked for at once, before any observer reports.
    const firstMonth = months[0];
    useEffect(() => {
        if (lazy && firstMonth !== undefined) request([firstMonth]);
    }, [lazy, firstMonth, request]);

    const registerRef = useCallback((month: string, el: HTMLElement | null) => {
        const old = elements.current.get(month);
        if (old && old !== el) observers.current.forEach((o) => o.unobserve(old));
        if (el) {
            elements.current.set(month, el);
            observers.current.forEach((o) => o.observe(el));
        } else {
            elements.current.delete(month);
        }
    }, []);

    const realign = useCallback((month: string) => {
        const p = pending.current;
        if (!p) return;
        p.waiting.delete(month);
        scrollTo(p.month);
        if (!suspended.current && !p.waiting.size) pending.current = null;
    }, [scrollTo]);

    const onLoaded = useCallback((month: string, data: AlbumMonthPayload) => {
        setCache((prev) => (prev.get(month) === data ? prev : new Map(prev).set(month, data)));
    }, []);

    const onSettled = useCallback((month: string) => {
        setSettled((prev) => toggled(prev, month, true));
        realign(month);
    }, [realign]);

    const jump = useCallback((month: string) => {
        suspended.current = true;
        // Months asked for but not loaded yet are dropped: the jump decides anew where to load
        // once it settles (a scrub never pays for the bands it passed, nor the first band).
        const keep = (m: string) => cacheRef.current.has(m) || settledRef.current.has(m);
        order.current = order.current.filter(keep);
        started.current = new Set([...started.current].filter(keep));
        setRequested((prev) => ([...prev].every(keep) ? prev : new Set([...prev].filter(keep))));
        // An already loaded target needs no re-align (a stale target would scroll later).
        pending.current = cacheRef.current.has(month) ? null : { month, waiting: new Set([month]) };
        scrollTo(month);
        armSettle();
    }, [scrollTo, armSettle]);

    const firstOpen = lazy ? -1 : months.findIndex((m) => !settled.has(m));
    // Grants: a started fetch keeps its slot while its band is mounted (never pre-empted); free
    // slots go to asked-for, mounted months in the order they were asked for. A settled month
    // stays requested, so its retry keeps working. Idempotent, so safe to run on every render.
    if (lazy) {
        const busy = [...started.current].filter((m) => live.has(m) && !settled.has(m) && !cache.has(m));
        let free = MAX_IN_FLIGHT - busy.length;
        for (const m of order.current) {
            if (free <= 0) break;
            if (started.current.has(m) || !requested.has(m) || !live.has(m) || settled.has(m) || cache.has(m)) continue;
            started.current.add(m);
            free -= 1;
        }
    }
    const isRequested = (month: string, index: number) => (lazy
        ? settled.has(month) || started.current.has(month)
        : requested.has(month) || firstOpen === -1 || index <= firstOpen);
    const isLive = (month: string) => !lazy || live.has(month);

    return { registerRef, isRequested, isLive, cache, onLoaded, onSettled, jump };
}
