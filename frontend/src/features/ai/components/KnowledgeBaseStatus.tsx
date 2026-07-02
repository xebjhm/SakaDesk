// frontend/src/features/ai/components/KnowledgeBaseStatus.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { useTranslation } from '../../../i18n';

/** `GET /api/ai/index/status`'s real shape (Plan B Task 5, `KnowledgeService.status()`
 * in `backend/services/knowledge_service.py`): a `document_count` total plus a
 * per-doc-type breakdown. There is no `is_rebuilding`/`total` field on the wire --
 * `status()` deliberately only reports what's already indexed. */
interface RawIndexStatus {
    service: string | null;
    document_count: number;
    by_type: Record<string, number>;
}

interface IndexStatus {
    documentCount: number;
    byType: Record<string, number>;
}

function parseStatus(raw: unknown): IndexStatus {
    const data = raw as Partial<RawIndexStatus> | null | undefined;
    return {
        documentCount: typeof data?.document_count === 'number' ? data.document_count : 0,
        byType: data?.by_type && typeof data.by_type === 'object' ? data.by_type : {},
    };
}

// `POST /api/ai/index/rebuild` is fire-and-forget (see `backend/api/ai.py`'s
// `_run_rebuild`): it schedules a background task and returns `{ok: true}`
// immediately, and `GET /index/status` never reports whether that background
// task is still running. So "rebuilding" here is a bounded client-side polling
// window (re-fetch status every `REBUILD_POLL_INTERVAL_MS`, up to
// `REBUILD_POLL_WINDOW_MS` total) rather than a server-confirmed completion
// signal -- mirroring the spinner-while-polling idiom `SettingsModal`'s blog
// backup status check already uses, minus a real "running" flag to key off of.
const REBUILD_POLL_INTERVAL_MS = 2000;
const REBUILD_POLL_WINDOW_MS = 20000;

/**
 * `KnowledgeBaseStatus` — Settings > AI > Knowledge base index status + rebuild.
 *
 * Shows how many documents are currently indexed for the active service
 * (`useAppStore`'s `activeService`) and a Rebuild button that kicks off a
 * reindex and polls status while it's (presumed) running.
 */
export const KnowledgeBaseStatus: React.FC = () => {
    const { t } = useTranslation();
    const activeService = useAppStore((s) => s.activeService);
    const [status, setStatus] = useState<IndexStatus | null>(null);
    const [isRebuilding, setIsRebuilding] = useState(false);

    const fetchStatus = useCallback((service: string) => {
        return fetch(`/api/ai/index/status?service=${encodeURIComponent(service)}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (data) setStatus(parseStatus(data));
            })
            .catch((err: unknown) => {
                console.error('[KnowledgeBaseStatus] Failed to fetch index status:', err);
            });
    }, []);

    // Load once per active service.
    useEffect(() => {
        if (!activeService) {
            setStatus(null);
            return;
        }
        setIsRebuilding(false);
        void fetchStatus(activeService);
    }, [activeService, fetchStatus]);

    // Poll while a rebuild is (presumed) in flight.
    useEffect(() => {
        if (!isRebuilding || !activeService) return;
        const service = activeService;
        let cancelled = false;
        const deadline = Date.now() + REBUILD_POLL_WINDOW_MS;

        const poll = () => {
            void fetchStatus(service).then(() => {
                if (cancelled) return;
                if (Date.now() >= deadline) {
                    setIsRebuilding(false);
                    return;
                }
                timer = setTimeout(poll, REBUILD_POLL_INTERVAL_MS);
            });
        };
        let timer = setTimeout(poll, REBUILD_POLL_INTERVAL_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [isRebuilding, activeService, fetchStatus]);

    const handleRebuild = () => {
        if (!activeService || isRebuilding) return;
        setIsRebuilding(true);
        fetch('/api/ai/index/rebuild', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ service: activeService }),
        }).catch((err: unknown) => {
            console.error('[KnowledgeBaseStatus] Failed to start rebuild:', err);
            setIsRebuilding(false);
        });
    };

    return (
        <div>
            <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">{t('settings.knowledgeBase')}</label>
                <button
                    onClick={handleRebuild}
                    disabled={!activeService || isRebuilding}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
                >
                    {isRebuilding
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RefreshCw className="w-3.5 h-3.5" />}
                    {t('settings.rebuildIndex')}
                </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
                {activeService
                    ? t('settings.kbIndexed', { count: status?.documentCount ?? 0 })
                    : t('blogs.selectService')}
            </p>
        </div>
    );
};
