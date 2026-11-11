/**
 * Grid-level loading state shared by the media galleries (media pipeline, 0.5.0): the minimum
 * visible time of a first-load indicator, and the "Preparing thumbnails… done / total" progress of
 * the background pre-generation worker (`GET /api/media/status`).
 */
import { useEffect, useState } from 'react';
import { settleDelay } from '../../../design/loading';
import { logDialogLoad } from '../../../design/dialog/dialogLog';

/** Re-read the worker's status this often while it prepares thumbnails (Settings uses the same pace). */
export const PREGEN_POLL_MS = 5_000;

/**
 * true while `active`, and afterwards for as long as a shown indicator still needs to reach the
 * L1 `minVisible` (`settleDelay`): a wait shorter than `reveal` never showed, so it is not held.
 * Keep the indicator (e.g. `StatusBlock kind="loading"`) mounted while this is true. The hold is
 * decided during render (a derived-state update), so the indicator is never unmounted for a
 * frame and its stage clock never restarts.
 */
export function useHeldLoading(active: boolean): boolean {
    const [startedAt, setStartedAt] = useState<number | null>(null);
    const [holdUntil, setHoldUntil] = useState<number | null>(null);

    if (active && startedAt === null) setStartedAt(performance.now());
    if (active && holdUntil !== null) setHoldUntil(null);
    let holding = holdUntil !== null;
    if (!active && startedAt !== null) {
        const delay = settleDelay(performance.now() - startedAt);
        setStartedAt(null);
        setHoldUntil(delay > 0 ? performance.now() + delay : null);
        holding = delay > 0;
    }

    useEffect(() => {
        if (holdUntil === null) return undefined;
        const timer = setTimeout(() => setHoldUntil(null), Math.max(0, holdUntil - performance.now()));
        return () => clearTimeout(timer);
    }, [holdUntil]);

    return active || holding;
}

export interface PregenProgress { done: number; total: number }

type ServiceCounts = Record<string, { done?: unknown; total?: unknown }>;

/**
 * `{done, total}` of the thumbnail pre-generation for `service` (every service summed when it is
 * not given) while the worker runs or pauses with work left; null when it is idle or stopped, has
 * nothing left, the cache is full (`thumbs_full`: it makes no new thumbnails), or the body is
 * malformed. Pure. A gallery pauses the worker (`foreground`), so `paused` still counts.
 */
export function pregenProgress(body: unknown, service: string | undefined): PregenProgress | null {
    const d = body as { state?: unknown; thumbs_full?: unknown; services?: ServiceCounts } | null;
    if (!d || (d.state !== 'running' && d.state !== 'paused') || d.thumbs_full === true) return null;
    const services = d.services && typeof d.services === 'object' ? d.services : {};
    const entries = service === undefined ? Object.values(services) : services[service] ? [services[service]] : [];
    let done = 0;
    let total = 0;
    for (const s of entries) {
        if (typeof s?.done !== 'number' || typeof s?.total !== 'number') return null;
        done += s.done;
        total += s.total;
    }
    return total > 0 && done < total ? { done, total } : null;
}

/**
 * The pre-generation progress for a gallery, while `active` (the gallery is open). Reads
 * `/api/media/status` once on open, and again every `PREGEN_POLL_MS` only while pre-generation is
 * still running for `service`; stops as soon as it is done, the cache is full, the read fails or
 * the gallery closes (no request after that). Logs `dialog_load` (`media_gallery_pregen`, `ok`
 * once per open, or `error`); codes only.
 */
export function usePregenProgress(active: boolean, service: string | undefined): PregenProgress | null {
    const [progress, setProgress] = useState<PregenProgress | null>(null);

    useEffect(() => {
        if (!active) {
            setProgress(null);
            return undefined;
        }
        let cancelled = false;
        let logged = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();
        const read = () => {
            fetch('/api/media/status', { signal: controller.signal })
                .then((res) => {
                    if (!res.ok) throw new Error('media status refused');
                    return res.json() as Promise<unknown>;
                })
                .then((body) => {
                    if (cancelled) return;
                    if (!logged) {
                        logged = true;
                        logDialogLoad('media_gallery_pregen', 'ok');
                    }
                    const next = pregenProgress(body, service);
                    setProgress(next);
                    if (next) timer = setTimeout(read, PREGEN_POLL_MS);
                })
                .catch(() => {
                    if (cancelled) return;
                    setProgress(null);
                    logDialogLoad('media_gallery_pregen', 'error');
                });
        };
        read();
        return () => {
            cancelled = true;
            clearTimeout(timer);
            controller.abort();
        };
    }, [active, service]);

    return active ? progress : null;
}
