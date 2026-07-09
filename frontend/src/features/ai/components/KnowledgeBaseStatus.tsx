// frontend/src/features/ai/components/KnowledgeBaseStatus.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { useTranslation } from '../../../i18n';
import { useIndexStatusPoll } from '../useIndexStatusPoll';

/** Localized phase label -- `discovering` (file scan) / `embedding` (batched
 * vector persist, with `done`/`total`) are the only phases the backend ever
 * reports (see `KnowledgeService._index_progress`'s constructor comment); an
 * unrecognized phase falls back to the generic "embedding" wording rather
 * than rendering raw/untranslated text. */
function phaseLabelKey(phase: string): string {
    return phase === 'discovering' ? 'settings.kbPhaseDiscovering' : 'settings.kbPhaseEmbedding';
}

/** `"3m 20s"` / `"45s"` for the `settings.kbEta` interpolation. */
function formatEta(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds % 60);
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * `KnowledgeBaseStatus` — Settings > AI > Knowledge base index status + rebuild.
 *
 * Shows how many documents are currently indexed for the active service
 * (`useAppStore`'s `activeService`), when it was last (re)indexed, and a
 * Rebuild button. While an index/rebuild is in flight for the active service
 * (`KnowledgeService`'s per-service in-flight registry -- see its module
 * docstring), the button is disabled and a real progress bar renders --
 * indeterminate (animated) while `discovering` hasn't produced a chunk total
 * yet, determinate with an ETA (chunks/sec measured across poll deltas, NOT
 * from `started_at`) once `embedding` reports `done`/`total`. The document
 * count stays visible DURING a rebuild too: `document_count` rises live as
 * batches persist. Polling is the shared `useIndexStatusPoll` loop, which
 * settles only after two consecutive idle reads (debounces the transient
 * mid-rebuild idle between per-source passes). The generic "already indexing"
 * note is a defensive fallback for a progress snapshot naming a different
 * service than the one queried.
 */
export const KnowledgeBaseStatus: React.FC = () => {
    const { t } = useTranslation();
    const activeService = useAppStore((s) => s.activeService);
    const [rebuildBlocked, setRebuildBlocked] = useState(false);
    const { status, start: startPolling, stop: stopPolling } = useIndexStatusPoll();

    // Load once per active service (and keep polling if an index happens to
    // already be running, e.g. the startup catch-up sweep or another client's
    // rebuild).
    useEffect(() => {
        setRebuildBlocked(false);
        if (!activeService) {
            stopPolling();
            return;
        }
        startPolling(activeService);
        return () => stopPolling();
    }, [activeService, startPolling, stopPolling]);

    const isRebuilding = !!status && status.progress.phase !== 'idle';
    const isThisServiceRebuilding = isRebuilding && status?.progress.service === activeService;

    // ETA (nice-to-have): chunks/sec from the delta between the last two poll
    // samples -- deliberately NOT from `started_at`, which averages over the
    // slow `discovering` phase and lies about the embedding rate. Hidden until
    // two samples show forward progress, and hidden again if a sample stalls.
    const etaSampleRef = useRef<{ done: number; at: number } | null>(null);
    const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
    useEffect(() => {
        const progress = status?.progress;
        if (!progress || progress.phase !== 'embedding' || progress.total <= 0) {
            etaSampleRef.current = null;
            setEtaSeconds(null);
            return;
        }
        const now = performance.now();
        const prev = etaSampleRef.current;
        etaSampleRef.current = { done: progress.done, at: now };
        if (!prev || now <= prev.at) return;
        const deltaChunks = progress.done - prev.done;
        if (deltaChunks <= 0) {
            setEtaSeconds(null); // stalled/unstable -- hide rather than mislead
            return;
        }
        const chunksPerSecond = deltaChunks / ((now - prev.at) / 1000);
        setEtaSeconds(Math.max(1, Math.round((progress.total - progress.done) / chunksPerSecond)));
    }, [status]);

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
                            <span className="flex gap-2">
                                {etaSeconds != null && (
                                    <span>{t('settings.kbEta', { eta: formatEta(etaSeconds) })}</span>
                                )}
                                <span>{Math.round((status.progress.done / status.progress.total) * 100)}%</span>
                            </span>
                        )}
                    </div>
                    {status.progress.total > 0 ? (
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-blue-400 transition-all duration-300 ease-out rounded-full"
                                style={{
                                    width: `${(status.progress.done / status.progress.total) * 100}%`,
                                }}
                            />
                        </div>
                    ) : (
                        // No chunk total yet (`discovering`'s multi-minute file
                        // scan) -- an animated indeterminate track instead of a
                        // dead bar frozen at 0%.
                        <div
                            className="h-1.5 bg-gray-100 rounded-full overflow-hidden"
                            data-testid="kb-indeterminate"
                        >
                            <div className="h-full w-1/3 bg-blue-400 rounded-full animate-pulse" />
                        </div>
                    )}
                </div>
            )}

            {activeService && isRebuilding && !isThisServiceRebuilding && (
                <p className="text-xs text-gray-500 mt-1">{t('settings.kbAlreadyIndexing')}</p>
            )}

            {/* Rendered during rebuilds too -- `document_count` is live and
                rises while batches persist, giving a sense of movement even
                before the chunk total is known. `lastBuilt` is only appended
                once idle (it's stale mid-rebuild). */}
            {activeService && (
                <p className="text-xs text-gray-500 mt-1">
                    {t('settings.kbIndexed', { count: status?.documentCount ?? 0 })}
                    {!isRebuilding && status?.lastBuilt && (
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

            {activeService && status?.reindexRequired && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2">
                    {t('settings.kbReindexRequired')}
                </p>
            )}
        </div>
    );
};
