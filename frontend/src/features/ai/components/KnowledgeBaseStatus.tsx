// frontend/src/features/ai/components/KnowledgeBaseStatus.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { useTranslation } from '../../../i18n';

/** `GET /api/ai/index/status`'s real shape (Task 3, `KnowledgeService.status()`
 * in `backend/services/knowledge_service.py`): a `document_count` total, a
 * per-doc-type breakdown, the LIVE `_index_progress` snapshot, and the
 * settings-owned `last_built` timestamp (enriched at the endpoint layer —
 * see `backend/api/ai.py`'s `index_status`). */
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
}

interface Progress {
    /** Which service this progress snapshot belongs to. `GET /index/status?service=X`
     * now returns X's OWN progress (`KnowledgeService`'s per-service in-flight
     * registry -- see that module's `_index_inflight`/`_index_progress`), so this
     * normally equals the queried `activeService`; kept as a field rather than
     * assumed so the UI stays correct even if a snapshot ever names a different
     * service (see `KnowledgeService.status`'s docstring). */
    service: string | null;
    phase: string;
    done: number;
    total: number;
}

interface IndexStatus {
    documentCount: number;
    byType: Record<string, number>;
    progress: Progress;
    lastBuilt: string | null;
}

const IDLE_PROGRESS: Progress = { service: null, phase: 'idle', done: 0, total: 0 };

function parseStatus(raw: unknown): IndexStatus {
    const data = raw as Partial<RawIndexStatus> | null | undefined;
    const rawProgress = data?.progress;
    const progress: Progress =
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
    };
}

// Real, server-confirmed progress (Task 3 item 3) replaces the old blind
// "poll for REBUILD_POLL_WINDOW_MS and hope it's done" window: `status().progress`
// now reports the actual `phase`/`done`/`total` of whichever index/rebuild is
// running, so polling continues for exactly as long as `phase !== 'idle'`.
const REBUILD_POLL_INTERVAL_MS = 2000;

/** Localized phase label -- `discovering` (file scan) / `embedding` (batched
 * vector persist, with `done`/`total`) are the only phases the backend ever
 * reports (see `KnowledgeService._index_progress`'s constructor comment); an
 * unrecognized phase falls back to the generic "embedding" wording rather
 * than rendering raw/untranslated text. */
function phaseLabelKey(phase: string): string {
    return phase === 'discovering' ? 'settings.kbPhaseDiscovering' : 'settings.kbPhaseEmbedding';
}

/**
 * `KnowledgeBaseStatus` — Settings > AI > Knowledge base index status + rebuild.
 *
 * Shows how many documents are currently indexed for the active service
 * (`useAppStore`'s `activeService`), when it was last (re)indexed, and a
 * Rebuild button. While an index/rebuild is in flight for the active service
 * (`KnowledgeService`'s per-service in-flight registry -- see its module
 * docstring), the button is disabled and a real progress bar replaces the
 * static count; the generic "already indexing" note is a defensive fallback
 * for a progress snapshot naming a different service than the one queried.
 */
export const KnowledgeBaseStatus: React.FC = () => {
    const { t } = useTranslation();
    const activeService = useAppStore((s) => s.activeService);
    const [status, setStatus] = useState<IndexStatus | null>(null);
    const [rebuildBlocked, setRebuildBlocked] = useState(false);
    const pollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const fetchStatus = useCallback((service: string): Promise<IndexStatus | null> => {
        return fetch(`/api/ai/index/status?service=${encodeURIComponent(service)}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!data) return null;
                const parsed = parseStatus(data);
                setStatus(parsed);
                return parsed;
            })
            .catch((err: unknown) => {
                console.error('[KnowledgeBaseStatus] Failed to fetch index status:', err);
                return null;
            });
    }, []);

    // Poll while an index/rebuild is (server-confirmed) actually running —
    // stops the instant `phase` reports back "idle", not after a fixed window.
    const pollStatus = useCallback(
        (service: string) => {
            void fetchStatus(service).then((parsed) => {
                if (parsed && parsed.progress.phase !== 'idle') {
                    pollTimerRef.current = setTimeout(() => pollStatus(service), REBUILD_POLL_INTERVAL_MS);
                }
            });
        },
        [fetchStatus]
    );

    const startPolling = useCallback(
        (service: string) => {
            if (pollTimerRef.current) {
                clearTimeout(pollTimerRef.current);
                pollTimerRef.current = undefined;
            }
            pollStatus(service);
        },
        [pollStatus]
    );

    // Load once per active service (and start polling if an index happens to
    // already be running, e.g. the startup catch-up sweep or another client's
    // rebuild).
    useEffect(() => {
        if (pollTimerRef.current) {
            clearTimeout(pollTimerRef.current);
            pollTimerRef.current = undefined;
        }
        if (!activeService) {
            setStatus(null);
            setRebuildBlocked(false);
            return;
        }
        setRebuildBlocked(false);
        startPolling(activeService);
        return () => {
            if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `startPolling` is stable per `activeService`'s fetchStatus closure
    }, [activeService]);

    const isRebuilding = !!status && status.progress.phase !== 'idle';
    const isThisServiceRebuilding = isRebuilding && status?.progress.service === activeService;

    const handleRebuild = async () => {
        if (!activeService || isRebuilding) return;
        setRebuildBlocked(false);
        try {
            const res = await fetch('/api/ai/index/rebuild', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ service: activeService }),
            });
            if (res.status === 409) {
                const body = await res.json().catch(() => null);
                const detail = (body?.detail ?? body) as { code?: string; alreadyRunning?: boolean } | null;
                if (detail?.code === 'kb_disabled') {
                    setRebuildBlocked(true);
                }
                // `alreadyRunning` (or any other 409): an index is confirmed active
                // process-wide -- resume polling so the real progress renders.
                startPolling(activeService);
                return;
            }
            if (!res.ok) throw new Error(`Rebuild request failed: ${res.status}`);
            startPolling(activeService);
        } catch (err) {
            console.error('[KnowledgeBaseStatus] Failed to start rebuild:', err);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">{t('settings.knowledgeBase')}</label>
                <button
                    onClick={() => void handleRebuild()}
                    disabled={!activeService || isRebuilding}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
                >
                    {isRebuilding
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RefreshCw className="w-3.5 h-3.5" />}
                    {t('settings.rebuildIndex')}
                </button>
            </div>

            {!activeService && <p className="text-xs text-gray-500 mt-1">{t('blogs.selectService')}</p>}

            {activeService && isThisServiceRebuilding && status && (
                <div className="mt-2">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>{t(phaseLabelKey(status.progress.phase), {
                            done: status.progress.done,
                            total: status.progress.total,
                        })}</span>
                        {status.progress.total > 0 && (
                            <span>{Math.round((status.progress.done / status.progress.total) * 100)}%</span>
                        )}
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-blue-400 transition-all duration-300 ease-out rounded-full"
                            style={{
                                width:
                                    status.progress.total > 0
                                        ? `${(status.progress.done / status.progress.total) * 100}%`
                                        : '0%',
                            }}
                        />
                    </div>
                </div>
            )}

            {activeService && isRebuilding && !isThisServiceRebuilding && (
                <p className="text-xs text-gray-500 mt-1">{t('settings.kbAlreadyIndexing')}</p>
            )}

            {activeService && !isRebuilding && (
                <p className="text-xs text-gray-500 mt-1">
                    {t('settings.kbIndexed', { count: status?.documentCount ?? 0 })}
                    {status?.lastBuilt && (
                        <span className="text-gray-400">
                            {' · '}
                            {t('settings.kbLastIndexed', { when: new Date(status.lastBuilt).toLocaleString() })}
                        </span>
                    )}
                </p>
            )}

            {rebuildBlocked && (
                <p className="text-xs text-amber-600 mt-1">{t('settings.kbDisabledHint')}</p>
            )}
        </div>
    );
};
