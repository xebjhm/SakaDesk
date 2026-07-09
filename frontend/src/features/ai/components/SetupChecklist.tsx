// frontend/src/features/ai/components/SetupChecklist.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleDashed, Download, Loader2, RefreshCw, X } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { useTranslation } from '../../../i18n';
import { errorMessageKey } from '../aiErrorCode';
import { useIndexStatusPoll } from '../useIndexStatusPoll';

/** `GET /api/ai/readiness`'s shape (`backend/services/knowledge_service.py`'s
 * `compute_readiness()`) -- independent, never-500 checks probed WITHOUT
 * constructing the full `KnowledgeService` (no ~1GB ONNX model load). */
interface ReadinessEmbeddingModel {
    ok: boolean;
    model?: string;
    path?: string;
    reason?: string;
    expectedPath?: string;
    provider?: string | null;
    providerConfirmed?: boolean;
    gpuRuntimeMissing?: boolean;
}

interface ReadinessLlm {
    ok: boolean;
    backend?: string | null;
    model?: string | null;
    reason?: string;
}

/** `compute_readiness()`'s `runtime` probe (`_runtime_probe`): whether the
 * ONNX runtime itself is importable, and if not, the provisioner's live
 * download state (`missing`/`downloading`/`verifying`/`extracting`/`error`). */
interface ReadinessRuntime {
    ok: boolean;
    state?: string;
    host?: string | null;
}

interface Readiness {
    enabled: boolean;
    embeddingModel: ReadinessEmbeddingModel;
    llm: ReadinessLlm;
    index: { documentCount: number };
    runtime?: ReadinessRuntime;
}

/** `GET /api/ai/models/download/status`'s shape (`ModelDownloadManager.status()`). */
interface DownloadStatus {
    state: 'idle' | 'downloading' | 'verifying' | 'done' | 'error' | 'cancelled';
    model: string | null;
    bytesDone: number;
    bytesTotal: number;
    reason: string | null;
}

/** `GET /api/ai/runtime/status`'s shape (`RuntimeProvisioner.status()`). */
interface RuntimeStatus {
    state: string;
    host: string | null;
    bytesDone: number;
    bytesTotal: number;
    reason: string | null;
}

const READINESS_POLL_MS = 3000;
const DOWNLOAD_POLL_MS = 500;
const RUNTIME_POLL_MS = 1000;

/** Provisioner states during which the "Setting up GPU runtime… {{pct}}%"
 * line renders and `/api/ai/runtime/status` is (lightly) polled. */
const RUNTIME_ACTIVE_STATES = new Set(['downloading', 'installing', 'verifying', 'extracting']);

function formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return mb < 1024 ? `${mb.toFixed(0)} MB` : `${(mb / 1024).toFixed(2)} GB`;
}

/** Human GPU name from an onnxruntime execution-provider id, or `null` when
 * the embedder is NOT confirmed to run on a GPU (CPU provider/unknown). */
function gpuNameFromProvider(provider: string | null | undefined): string | null {
    if (!provider) return null;
    if (provider.includes('Dml')) return 'DirectML';
    if (provider.includes('CUDA')) return 'CUDA';
    return null;
}

interface RowProps {
    ok: boolean;
    label: string;
    children?: React.ReactNode;
    action?: React.ReactNode;
}

const ChecklistRow: React.FC<RowProps> = ({ ok, label, children, action }) => (
    <div className="flex items-start gap-2">
        {ok ? (
            <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
        ) : (
            <CircleDashed className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-gray-700">{label}</span>
                {action}
            </div>
            {children}
        </div>
    </div>
);

export interface SetupChecklistProps {
    /** Fired once (readiness is server-confirmed) `enabled && embeddingModel.ok
     * && llm.ok && runtime.ok && documentCount > 0` all hold -- lets a caller
     * (e.g. `ChatWindow`'s empty state) hide this checklist and re-enable the
     * chat input. Not called again on a later regression (rare mid-session;
     * the checklist itself keeps reflecting reality if re-mounted, e.g.
     * re-opening Settings). */
    onReady?: () => void;
}

/**
 * `SetupChecklist` — first-run KB-chatbot provisioning status, shown in BOTH
 * the chat empty state (`ChatWindow`) and Settings (`SettingsModal`).
 *
 * Four rows driven by `GET /api/ai/readiness`: an Enable toggle (finding M2 --
 * the ready gate requires `enabled`, so the checklist must offer the switch
 * itself instead of showing all-green rows over a locked composer), Embedding
 * model (with an in-app Download button + live progress bar while a download
 * is running, and an honest GPU/runtime line), AI backend (with a button into
 * AI settings -- `KbBackendSelector` owns the actual configuration), and
 * Index (document count + a Build button, with LIVE build progress via the
 * shared `useIndexStatusPoll` while an index/rebuild runs). Polls readiness
 * every `READINESS_POLL_MS` until every check passes, then stops (and fires
 * `onReady`) -- a fully-configured install settles into a single fetch, not
 * an indefinite background poll.
 */
export const SetupChecklist: React.FC<SetupChecklistProps> = ({ onReady }) => {
    const { t } = useTranslation();
    const activeService = useAppStore((s) => s.activeService);
    // Cross-wave contract: `openSettings(tab)` is added to the app store in
    // this same wave -- typed structurally (and called optionally) here so
    // this file neither depends on that branch landing first nor breaks once
    // it does.
    const openSettings = useAppStore(
        (s) => (s as unknown as { openSettings?: (tab: string) => void }).openSettings
    );

    const [readiness, setReadiness] = useState<Readiness | null>(null);
    const [download, setDownload] = useState<DownloadStatus | null>(null);
    const [rebuilding, setRebuilding] = useState(false);
    const [enabledSaving, setEnabledSaving] = useState(false);
    const [runtimeProgress, setRuntimeProgress] = useState<RuntimeStatus | null>(null);
    // The i18n key (`ai.error.<code>`) for the most recent `POST /api/ai/
    // index/rebuild` failure, or `null` once cleared -- P-4 review, Finding
    // 1: `handleBuildIndex` used to only catch NETWORK failures (a rejected
    // fetch promise); a non-2xx response (409 `not_configured`/
    // `already_running`/`kb_disabled`) resolved normally and was silently
    // dropped, leaving the user staring at a spinner that finished with no
    // explanation. See `handleBuildIndex` below.
    const [buildErrorKey, setBuildErrorKey] = useState<string | null>(null);
    const readinessTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const downloadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const runtimeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const readyFiredRef = useRef(false);
    // The mount-time catch-up poll (an index build may already be running,
    // e.g. the startup sweep or a rebuild started from Settings) runs at most
    // once per mount, the first time readiness confirms the embedding model
    // is installed -- see the gate effect below.
    const indexPollStartedRef = useRef(false);

    const fetchReadiness = useCallback((): Promise<Readiness | null> => {
        return fetch('/api/ai/readiness')
            .then((res) => (res.ok ? res.json() : null))
            .then((data: Readiness | null) => {
                if (data) setReadiness(data);
                return data;
            })
            .catch((err: unknown) => {
                console.error('[SetupChecklist] Failed to fetch readiness:', err);
                return null;
            });
    }, []);

    const pollReadiness = useCallback(() => {
        void fetchReadiness().then((data) => {
            // Ready gate (findings M5/M8): beyond enabled + model + LLM, the
            // chat is only genuinely usable once the ONNX runtime is in place
            // AND the index actually has content -- an all-green checklist
            // over an empty index was a false-ready (the zero-docs case gets
            // its own explanatory row instead, see the index row below).
            const ready =
                !!data &&
                data.enabled &&
                data.embeddingModel.ok &&
                data.llm.ok &&
                !!data.runtime?.ok &&
                data.index.documentCount > 0;
            if (ready) {
                if (!readyFiredRef.current) {
                    readyFiredRef.current = true;
                    onReady?.();
                }
                return; // fully configured -- stop polling
            }
            readinessTimer.current = setTimeout(pollReadiness, READINESS_POLL_MS);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `onReady` is treated as stable (parent-owned callback)
    }, [fetchReadiness]);

    useEffect(() => {
        pollReadiness();
        return () => {
            if (readinessTimer.current) clearTimeout(readinessTimer.current);
            if (downloadTimer.current) clearTimeout(downloadTimer.current);
            if (runtimeTimer.current) clearTimeout(runtimeTimer.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
    }, []);

    // Live index-status poll (owner complaint #2 -- clicking Build showed
    // NOTHING for a multi-minute background job). Settling (two consecutive
    // idle reads, see `useIndexStatusPoll`) re-fetches readiness once for the
    // final document count.
    const { status: indexStatus, start: startIndexPoll } = useIndexStatusPoll({
        onSettled: () => {
            setRebuilding(false);
            void fetchReadiness();
        },
    });
    const isIndexing = !!indexStatus && indexStatus.progress.phase !== 'idle';

    // Gate the catch-up poll behind `embeddingModel.ok`: `GET /index/status`
    // constructs the `KnowledgeService` (a ~1GB embedder load), so it must
    // never be polled before the model is installed.
    useEffect(() => {
        if (indexPollStartedRef.current || !activeService) return;
        if (readiness?.embeddingModel.ok) {
            indexPollStartedRef.current = true;
            startIndexPoll(activeService);
        }
    }, [readiness, activeService, startIndexPoll]);

    const pollDownload = useCallback(() => {
        fetch('/api/ai/models/download/status')
            .then((res) => (res.ok ? res.json() : null))
            .then((data: DownloadStatus | null) => {
                if (!data) return;
                setDownload(data);
                if (data.state === 'downloading' || data.state === 'verifying') {
                    downloadTimer.current = setTimeout(pollDownload, DOWNLOAD_POLL_MS);
                } else if (data.state === 'done') {
                    pollReadiness();
                }
            })
            .catch((err: unknown) => {
                console.error('[SetupChecklist] Failed to fetch download status:', err);
            });
    }, [pollReadiness]);

    const handleDownload = useCallback(() => {
        fetch('/api/ai/models/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        })
            .then((res) => {
                if (res.ok || res.status === 409) pollDownload();
            })
            .catch((err: unknown) => {
                console.error('[SetupChecklist] Failed to start model download:', err);
            });
    }, [pollDownload]);

    const handleCancelDownload = useCallback(() => {
        fetch('/api/ai/models/download', { method: 'DELETE' })
            .catch((err: unknown) => {
                console.error('[SetupChecklist] Failed to cancel model download:', err);
            })
            .finally(() => {
                if (downloadTimer.current) clearTimeout(downloadTimer.current);
                pollDownload();
            });
    }, [pollDownload]);

    // While the on-demand ONNX runtime download is running (readiness's
    // `runtime.state`), lightly poll `/api/ai/runtime/status` for byte-level
    // progress -- readiness itself only carries the coarse state.
    const runtimeSettingUp = !!readiness?.runtime?.state && RUNTIME_ACTIVE_STATES.has(readiness.runtime.state);
    useEffect(() => {
        if (!runtimeSettingUp) {
            if (runtimeTimer.current) {
                clearTimeout(runtimeTimer.current);
                runtimeTimer.current = undefined;
            }
            setRuntimeProgress(null);
            return;
        }
        let cancelled = false;
        const tick = () => {
            fetch('/api/ai/runtime/status')
                .then((res) => (res.ok ? res.json() : null))
                .then((data: RuntimeStatus | null) => {
                    if (cancelled || !data) return;
                    setRuntimeProgress(data);
                    if (RUNTIME_ACTIVE_STATES.has(data.state)) {
                        runtimeTimer.current = setTimeout(tick, RUNTIME_POLL_MS);
                    } else {
                        // Finished (or failed) -- refresh readiness so the
                        // coarse `runtime.state` catches up and this poll's
                        // gating flag flips off.
                        void fetchReadiness();
                    }
                })
                .catch((err: unknown) => {
                    console.error('[SetupChecklist] Failed to fetch runtime status:', err);
                });
        };
        tick();
        return () => {
            cancelled = true;
            if (runtimeTimer.current) clearTimeout(runtimeTimer.current);
        };
    }, [runtimeSettingUp, fetchReadiness]);

    const handleToggleEnabled = useCallback(() => {
        if (!readiness || enabledSaving) return;
        const next = !readiness.enabled;
        setEnabledSaving(true);
        fetch('/api/ai/enabled', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: next }),
        })
            .then(() => fetchReadiness())
            .catch((err: unknown) => {
                console.error('[SetupChecklist] Failed to toggle KB enabled state:', err);
            })
            .finally(() => setEnabledSaving(false));
    }, [readiness, enabledSaving, fetchReadiness]);

    const handleBuildIndex = useCallback(() => {
        if (!activeService) return;
        setRebuilding(true);
        setBuildErrorKey(null);
        fetch('/api/ai/index/rebuild', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ service: activeService }),
        })
            .then(async (res) => {
                if (res.ok) {
                    // The rebuild endpoint returns immediately (background
                    // build) -- the index-status poll now owns the "still
                    // running" signal, and its onSettled clears `rebuilding`
                    // + refreshes readiness. Keying the Build button to the
                    // POST lifetime alone left it re-enabled (and the row
                    // static) for the whole multi-minute build.
                    startIndexPoll(activeService);
                    return;
                }
                // Non-2xx (P-4 review, Finding 1): a 409 `not_configured`
                // (the embedding model was never installed, or the in-app
                // download hasn't been picked up yet), `already_running`, or
                // `kb_disabled` must be VISIBLE, not silently swallowed --
                // parse the JSON error body (FastAPI wraps it in `detail`)
                // and show the typed message via the shared `ai.error.<code>`
                // i18n mapping (same taxonomy `ChatWindow.tsx`'s ask errors
                // use, see `../aiErrorCode.ts`).
                const body: unknown = await res.json().catch(() => null);
                const detail = (
                    body && typeof body === 'object' && 'detail' in body
                        ? (body as { detail: unknown }).detail
                        : body
                ) as { code?: string } | null;
                setBuildErrorKey(errorMessageKey(detail?.code ?? 'unknown'));
                setRebuilding(false);
                void fetchReadiness();
            })
            .catch((err: unknown) => {
                console.error('[SetupChecklist] Failed to start index rebuild:', err);
                setBuildErrorKey(errorMessageKey('network'));
                setRebuilding(false);
            });
    }, [activeService, startIndexPoll, fetchReadiness]);

    if (!readiness) {
        return (
            <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('ai.setup.checking')}
            </div>
        );
    }

    const isDownloading = download?.state === 'downloading' || download?.state === 'verifying';
    const gpuName = readiness.embeddingModel.ok ? gpuNameFromProvider(readiness.embeddingModel.provider) : null;
    const runtimePct =
        runtimeProgress && runtimeProgress.bytesTotal > 0
            ? Math.min(100, Math.round((runtimeProgress.bytesDone / runtimeProgress.bytesTotal) * 100))
            : 0;
    const buildBusy = rebuilding || isIndexing;
    const progress = indexStatus?.progress;

    return (
        <div className="w-full max-w-sm space-y-3 text-left" data-testid="setup-checklist">
            <ChecklistRow
                ok={readiness.enabled}
                label={t('ai.setup.enableKb')}
                action={
                    <button
                        type="button"
                        role="switch"
                        aria-checked={readiness.enabled}
                        aria-label={t('ai.setup.enableKb')}
                        onClick={handleToggleEnabled}
                        disabled={enabledSaving}
                        className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 shrink-0 ${
                            readiness.enabled ? 'bg-blue-400' : 'bg-gray-300'
                        }`}
                    >
                        <div
                            className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                                readiness.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                            }`}
                        />
                    </button>
                }
            />

            <ChecklistRow
                ok={readiness.embeddingModel.ok}
                label={t('ai.setup.embeddingModel')}
                action={
                    !readiness.embeddingModel.ok && !isDownloading ? (
                        <button
                            type="button"
                            onClick={handleDownload}
                            className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-full px-2.5 py-1 shrink-0"
                        >
                            <Download className="w-3 h-3" />
                            {t('ai.setup.downloadModel')}
                        </button>
                    ) : undefined
                }
            >
                {isDownloading && download && (
                    <div className="mt-1.5">
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-blue-400 transition-all duration-300 ease-out rounded-full"
                                style={{
                                    width:
                                        download.bytesTotal > 0
                                            ? `${Math.min(100, (download.bytesDone / download.bytesTotal) * 100)}%`
                                            : '0%',
                                }}
                            />
                        </div>
                        <div className="flex items-center justify-between mt-1 text-xs text-gray-400">
                            <span>
                                {formatBytes(download.bytesDone)} / {formatBytes(download.bytesTotal)}
                            </span>
                            <button
                                type="button"
                                onClick={handleCancelDownload}
                                aria-label={t('ai.setup.cancelDownload')}
                                className="flex items-center gap-1 text-gray-400 hover:text-gray-600"
                            >
                                <X className="w-3 h-3" />
                                {t('ai.setup.cancelDownload')}
                            </button>
                        </div>
                    </div>
                )}
                {download?.state === 'error' && (
                    <p className="text-xs text-red-600 mt-1">{t('ai.setup.downloadFailed')}</p>
                )}
                {/* Runtime/GPU honesty (owner complaint #1): a live "setting
                    up" line while the runtime downloads; a positive line when
                    the embedder is CONFIRMED on a GPU provider (the old amber
                    "running on CPU" text was flat-out false on DirectML
                    machines); the truthful amber hint only when no GPU
                    provider is active AND the runtime really is missing. */}
                {runtimeSettingUp ? (
                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                        {t('ai.setup.runtimeSettingUp', { pct: runtimePct })}
                    </p>
                ) : gpuName ? (
                    <p className="text-xs text-green-600 mt-1">{t('ai.setup.gpuActive', { name: gpuName })}</p>
                ) : readiness.embeddingModel.ok && readiness.embeddingModel.gpuRuntimeMissing ? (
                    <p className="text-xs text-amber-600 mt-1">{t('ai.setup.gpuRuntimeMissing')}</p>
                ) : null}
            </ChecklistRow>

            <ChecklistRow ok={readiness.llm.ok} label={t('ai.setup.aiBackend')}>
                {!readiness.llm.ok && (
                    <button
                        type="button"
                        onClick={() => openSettings?.('ai')}
                        className="text-xs text-amber-600 hover:text-amber-700 underline underline-offset-2 decoration-amber-300 mt-1 text-left"
                    >
                        {t('ai.setup.configureBackendHint')}
                    </button>
                )}
            </ChecklistRow>

            <ChecklistRow
                ok={readiness.index.documentCount > 0}
                label={t('ai.setup.index', { count: readiness.index.documentCount })}
                action={
                    <button
                        type="button"
                        onClick={handleBuildIndex}
                        disabled={!activeService || !readiness.embeddingModel.ok || buildBusy}
                        className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-full px-2.5 py-1 shrink-0 disabled:opacity-40"
                    >
                        {buildBusy ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                            <RefreshCw className="w-3 h-3" />
                        )}
                        {t('ai.setup.buildIndex')}
                    </button>
                }
            >
                {isIndexing && indexStatus && progress && (
                    <div className="mt-1.5">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                            <span>
                                {t(
                                    progress.phase === 'discovering'
                                        ? 'settings.kbPhaseDiscovering'
                                        : 'settings.kbPhaseEmbedding',
                                    { done: progress.done, total: progress.total }
                                )}
                            </span>
                        </div>
                        {/* LIVE count -- `document_count` rises while the build
                            writes batches, so the user sees movement even
                            before chunk totals are known. */}
                        <p className="text-xs text-gray-400 mt-0.5">
                            {t('ai.setup.indexedSoFar', { count: indexStatus.documentCount })}
                        </p>
                        {progress.total > 0 && (
                            <div
                                className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1"
                                data-testid="index-progress-bar"
                            >
                                <div
                                    className="h-full bg-blue-400 transition-all duration-300 ease-out rounded-full"
                                    style={{
                                        width: `${Math.min(100, (progress.done / progress.total) * 100)}%`,
                                    }}
                                />
                            </div>
                        )}
                    </div>
                )}
                {/* Zero-docs honesty (finding M5/M8): everything is configured
                    but there's nothing to search -- explain instead of showing
                    a false all-green. */}
                {!isIndexing &&
                    readiness.enabled &&
                    readiness.embeddingModel.ok &&
                    readiness.llm.ok &&
                    readiness.index.documentCount === 0 && (
                        <p className="text-xs text-gray-500 mt-1">{t('ai.setup.noContent')}</p>
                    )}
                {buildErrorKey && <p className="text-xs text-red-600 mt-1">{t(buildErrorKey)}</p>}
            </ChecklistRow>
        </div>
    );
};
