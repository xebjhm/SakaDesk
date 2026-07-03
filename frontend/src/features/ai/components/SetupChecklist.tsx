// frontend/src/features/ai/components/SetupChecklist.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleDashed, Download, Loader2, RefreshCw, X } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { useTranslation } from '../../../i18n';
import { errorMessageKey } from '../aiErrorCode';

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

interface Readiness {
    enabled: boolean;
    embeddingModel: ReadinessEmbeddingModel;
    llm: ReadinessLlm;
    index: { documentCount: number };
}

/** `GET /api/ai/models/download/status`'s shape (`ModelDownloadManager.status()`). */
interface DownloadStatus {
    state: 'idle' | 'downloading' | 'verifying' | 'done' | 'error' | 'cancelled';
    model: string | null;
    bytesDone: number;
    bytesTotal: number;
    reason: string | null;
}

const READINESS_POLL_MS = 3000;
const DOWNLOAD_POLL_MS = 500;

function formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return mb < 1024 ? `${mb.toFixed(0)} MB` : `${(mb / 1024).toFixed(2)} GB`;
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
     * && llm.ok` all hold -- lets a caller (e.g. `ChatWindow`'s empty state)
     * hide this checklist and re-enable the chat input. Not called again on
     * a later regression (rare mid-session; the checklist itself keeps
     * reflecting reality if re-mounted, e.g. re-opening Settings). */
    onReady?: () => void;
}

/**
 * `SetupChecklist` — first-run KB-chatbot provisioning status, shown in BOTH
 * the chat empty state (`ChatWindow`) and Settings (`SettingsModal`).
 *
 * Three rows driven by `GET /api/ai/readiness`: Embedding model (with an
 * in-app Download button + live progress bar while a download is running),
 * AI backend (read-only status -- configuring it lives in `KbBackendSelector`
 * just below this in Settings), and Index (document count + a Build button
 * that calls the existing `/api/ai/index/rebuild` for the active service).
 * Polls readiness every `READINESS_POLL_MS` until every check passes, then
 * stops (and fires `onReady`) -- a fully-configured install settles into a
 * single fetch, not an indefinite background poll.
 */
export const SetupChecklist: React.FC<SetupChecklistProps> = ({ onReady }) => {
    const { t } = useTranslation();
    const activeService = useAppStore((s) => s.activeService);

    const [readiness, setReadiness] = useState<Readiness | null>(null);
    const [download, setDownload] = useState<DownloadStatus | null>(null);
    const [rebuilding, setRebuilding] = useState(false);
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
    const readyFiredRef = useRef(false);

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
            const ready = !!data && data.enabled && data.embeddingModel.ok && data.llm.ok;
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
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
    }, []);

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
                if (res.ok) return;
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
            })
            .catch((err: unknown) => {
                console.error('[SetupChecklist] Failed to start index rebuild:', err);
                setBuildErrorKey(errorMessageKey('network'));
            })
            .finally(() => {
                setRebuilding(false);
                pollReadiness();
            });
    }, [activeService, pollReadiness]);

    if (!readiness) {
        return (
            <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('ai.setup.checking')}
            </div>
        );
    }

    const isDownloading = download?.state === 'downloading' || download?.state === 'verifying';

    return (
        <div className="w-full max-w-sm space-y-3 text-left" data-testid="setup-checklist">
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
                {readiness.embeddingModel.ok && readiness.embeddingModel.gpuRuntimeMissing && (
                    <p className="text-xs text-amber-600 mt-1">{t('ai.setup.gpuRuntimeMissing')}</p>
                )}
            </ChecklistRow>

            <ChecklistRow ok={readiness.llm.ok} label={t('ai.setup.aiBackend')}>
                {!readiness.llm.ok && (
                    <p className="text-xs text-amber-600 mt-1">{t('ai.setup.configureBackendHint')}</p>
                )}
            </ChecklistRow>

            <ChecklistRow
                ok={readiness.index.documentCount > 0}
                label={t('ai.setup.index', { count: readiness.index.documentCount })}
                action={
                    <button
                        type="button"
                        onClick={handleBuildIndex}
                        disabled={!activeService || !readiness.embeddingModel.ok || rebuilding}
                        className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-full px-2.5 py-1 shrink-0 disabled:opacity-40"
                    >
                        {rebuilding ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                            <RefreshCw className="w-3 h-3" />
                        )}
                        {t('ai.setup.buildIndex')}
                    </button>
                }
            >
                {buildErrorKey && <p className="text-xs text-red-600 mt-1">{t(buildErrorKey)}</p>}
            </ChecklistRow>
        </div>
    );
};
