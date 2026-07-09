// frontend/src/features/ai/useIndexStatusPoll.ts
import { useCallback, useEffect, useRef, useState } from 'react';

/** `GET /api/ai/index/status`'s real shape (`KnowledgeService.status()` in
 * `backend/services/knowledge_service.py`): a live `document_count` total (it
 * RISES while a build is writing batches), a per-doc-type breakdown, the
 * in-flight `_index_progress` snapshot, and the settings-owned `last_built`
 * timestamp (enriched at the endpoint layer -- see `backend/api/ai.py`'s
 * `index_status`). NOTE `progress.done`/`progress.total` count CHUNKS, not
 * documents. */
interface RawProgress {
    service: string | null;
    phase: string;
    done: number;
    total: number;
    started_at: string | null;
}

interface RawIndexStatus {
    service: string | null;
    document_count: number;
    by_type: Record<string, number>;
    progress: RawProgress;
    last_built: string | null;
    configured?: boolean;
    provider?: string | null;
    /** Embedder-fingerprint mismatch (Product-wave Task 4 fold-in) -- set
     * when the active embedding model config no longer matches what the
     * persisted vectors were embedded with. Incremental index writes are
     * blocked server-side until a Rebuild clears it. */
    reindex_required?: boolean;
}

export interface IndexProgress {
    /** Which service this progress snapshot belongs to. `GET /index/status?service=X`
     * returns X's OWN progress (`KnowledgeService`'s per-service in-flight
     * registry), so this normally equals the queried service; kept as a field
     * rather than assumed so the UI stays correct even if a snapshot ever
     * names a different service (see `KnowledgeService.status`'s docstring). */
    service: string | null;
    phase: string;
    /** Embedded CHUNKS so far (not documents). */
    done: number;
    /** Total CHUNKS to embed; `0` while still `discovering`. */
    total: number;
}

export interface IndexStatus {
    documentCount: number;
    byType: Record<string, number>;
    progress: IndexProgress;
    lastBuilt: string | null;
    reindexRequired: boolean;
}

export const IDLE_PROGRESS: IndexProgress = { service: null, phase: 'idle', done: 0, total: 0 };

export const REBUILD_POLL_INTERVAL_MS = 2000;

/** How many CONSECUTIVE `phase === 'idle'` reads (or failed fetches) it takes
 * before the poll loop settles. Two, not one: the backend briefly reports
 * `idle` between a rebuild's per-source passes (e.g. members done, blogs not
 * yet started), and a single-read stop would freeze the UI mid-build. A
 * backend fix narrows that window, but the client-side debounce stays as
 * belt-and-braces. */
const IDLE_READS_TO_SETTLE = 2;

export function parseIndexStatus(raw: unknown): IndexStatus {
    const data = raw as Partial<RawIndexStatus> | null | undefined;
    const rawProgress = data?.progress;
    const progress: IndexProgress =
        rawProgress && typeof rawProgress === 'object'
            ? {
                  service: typeof rawProgress.service === 'string' ? rawProgress.service : null,
                  phase: typeof rawProgress.phase === 'string' ? rawProgress.phase : 'idle',
                  done: typeof rawProgress.done === 'number' ? rawProgress.done : 0,
                  total: typeof rawProgress.total === 'number' ? rawProgress.total : 0,
              }
            : IDLE_PROGRESS;
    return {
        documentCount: typeof data?.document_count === 'number' ? data.document_count : 0,
        byType: data?.by_type && typeof data.by_type === 'object' ? data.by_type : {},
        progress,
        lastBuilt: typeof data?.last_built === 'string' ? data.last_built : null,
        reindexRequired: data?.reindex_required === true,
    };
}

export interface UseIndexStatusPollOptions {
    /** Fired ONCE each time an active poll loop settles (two consecutive idle
     * reads confirm no build is running) -- e.g. refresh `/api/ai/readiness`
     * for the final document count. NOT fired on a manual `stop()`/unmount. */
    onSettled?: () => void;
}

export interface UseIndexStatusPollResult {
    /** Last successfully-fetched (parsed) status, or `null` before the first
     * read. Preserved across transient fetch failures. */
    status: IndexStatus | null;
    /** `true` while the poll loop is running (from `start()` until it settles
     * on two consecutive idle reads, or `stop()`/unmount). */
    isActive: boolean;
    /** (Re)start polling `/api/ai/index/status?service=…`: one fetch
     * immediately, then a ref-held chained `setTimeout` every
     * `REBUILD_POLL_INTERVAL_MS`. Restarting resets the idle debounce. */
    start: (service: string) => void;
    /** Halt polling immediately (clears the pending timer; `onSettled` is not
     * fired). `status` is left as-is. */
    stop: () => void;
}

/**
 * `useIndexStatusPoll` — shared poll loop for `GET /api/ai/index/status`.
 *
 * Extracted from `KnowledgeBaseStatus`'s rebuild polling so `SetupChecklist`
 * can drive the same live index progress (spinner/phase/chunk bar/rising doc
 * count) without duplicating the timer/debounce plumbing. Callers are
 * responsible for gating `start()` behind `readiness.embeddingModel.ok` --
 * the status endpoint constructs the `KnowledgeService`, so polling it before
 * the embedding model is installed would trigger a ~1GB embedder load.
 */
export function useIndexStatusPoll(options?: UseIndexStatusPollOptions): UseIndexStatusPollResult {
    const [status, setStatus] = useState<IndexStatus | null>(null);
    const [isActive, setIsActive] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    // Bumped by every start()/stop()/unmount: an in-flight fetch from a
    // superseded loop sees a stale generation and drops its result instead of
    // scheduling another tick.
    const generationRef = useRef(0);
    const onSettledRef = useRef(options?.onSettled);
    onSettledRef.current = options?.onSettled;

    const stop = useCallback(() => {
        generationRef.current += 1;
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = undefined;
        }
        setIsActive(false);
    }, []);

    const start = useCallback((service: string) => {
        generationRef.current += 1;
        const generation = generationRef.current;
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = undefined;
        }
        setIsActive(true);
        let idleStreak = 0;

        const tick = () => {
            fetch(`/api/ai/index/status?service=${encodeURIComponent(service)}`)
                .then((res) => (res.ok ? res.json() : null))
                .catch((err: unknown) => {
                    console.error('[useIndexStatusPoll] Failed to fetch index status:', err);
                    return null;
                })
                .then((data: unknown) => {
                    if (generation !== generationRef.current) return; // superseded
                    const parsed = data ? parseIndexStatus(data) : null;
                    if (parsed) setStatus(parsed);
                    // A failed read counts toward the idle streak too, so a dead
                    // backend can't keep the loop alive forever.
                    if (parsed && parsed.progress.phase !== 'idle') {
                        idleStreak = 0;
                    } else {
                        idleStreak += 1;
                        if (idleStreak >= IDLE_READS_TO_SETTLE) {
                            setIsActive(false);
                            onSettledRef.current?.();
                            return;
                        }
                    }
                    timerRef.current = setTimeout(tick, REBUILD_POLL_INTERVAL_MS);
                });
        };
        tick();
    }, []);

    useEffect(
        () => () => {
            generationRef.current += 1;
            if (timerRef.current) clearTimeout(timerRef.current);
        },
        []
    );

    return { status, isActive, start, stop };
}
