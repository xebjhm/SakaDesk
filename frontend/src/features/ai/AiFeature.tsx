// frontend/src/features/ai/AiFeature.tsx
import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import { askKnowledge, AskError, providerNameFromBaseUrl } from './api';
import { ChatWindow } from './components/ChatWindow';
import { CloudConsentModal } from './components/CloudConsentModal';
import { deriveHistory } from './deriveHistory';

// Monotonic id generator for chat turns — deterministic and dependency-free
// (no crypto.randomUUID needed for a purely local, non-persisted thread).
let turnCounter = 0;
function nextTurnId(): string {
    turnCounter += 1;
    return `turn-${Date.now()}-${turnCounter}`;
}

/**
 * Known `event: progress` stage codes -> i18n key. `thinking` is the default
 * heartbeat while the ask resolves; `indexing` is Task 3's lock-fairness
 * label -- `_ask_event_stream`'s heartbeat emits `{stage: "indexing", done,
 * total}` instead of a false "thinking" while a queued ask is waiting
 * BETWEEN embed batches for a concurrent index (see
 * `backend/api/ai.py`'s `_heartbeat_payload`). An unrecognized or empty
 * stage (e.g. `askKnowledge`'s `''` fallback for a malformed payload) falls
 * back to the generic "thinking" label so the user never sees
 * raw/untranslated text. (A `verifying` stage was once reserved here for a
 * future per-tool-call progress hook -- removed with its `ai.verifying`
 * key as dead code, expert review WIN 7c; re-add both when the backend
 * actually emits it.)
 */
const PROGRESS_LABEL_KEYS: Record<string, string> = {
    thinking: 'ai.thinking',
    indexing: 'ai.indexing',
};

function progressLabelKey(stage: string): string {
    return PROGRESS_LABEL_KEYS[stage] ?? 'ai.thinking';
}

/**
 * Extracts `ErrorTurn` fields from a rejected `askKnowledge` promise. Duck-typed
 * (checks for a `.code` string property) rather than `instanceof AskError` so a
 * plain `Error` (a legacy/uncoded rejection, or any other unexpected throw)
 * degrades gracefully to `code: 'unknown'` instead of crashing.
 */
function askErrorFields(err: unknown): {
    code: string;
    message: string;
    retryAfterS?: number;
    backend?: string;
    model?: string;
    requestsToday?: number;
    dailyLimit?: number;
    estQuestionsLeft?: number;
} {
    const message = err instanceof Error ? err.message : String(err);
    if (err && typeof err === 'object') {
        const obj = err as Record<string, unknown>;
        return {
            code: typeof obj.code === 'string' ? obj.code : 'unknown',
            message,
            retryAfterS: typeof obj.retryAfterS === 'number' ? obj.retryAfterS : undefined,
            backend: typeof obj.backend === 'string' ? obj.backend : undefined,
            model: typeof obj.model === 'string' ? obj.model : undefined,
            requestsToday: typeof obj.requestsToday === 'number' ? obj.requestsToday : undefined,
            dailyLimit: typeof obj.dailyLimit === 'number' ? obj.dailyLimit : undefined,
            estQuestionsLeft:
                typeof obj.estQuestionsLeft === 'number' ? obj.estQuestionsLeft : undefined,
        };
    }
    return { code: 'unknown', message };
}

/**
 * `AiFeature` — the KB-chatbot chat UI. Mirrors `BlogsFeature`'s structure:
 * reads `activeService` from the app store, renders a "select a service"
 * placeholder when there isn't one.
 *
 * Chat threads live in the global `appStore` (Product-wave Task 6) -- not
 * local component state -- so a tab switch (including a citation chip's
 * `navigateToSource`, which changes `activeFeature` and unmounts this
 * component) no longer destroys the conversation, and an answer that
 * resolves while `AiFeature` is unmounted still lands in the thread when the
 * user comes back. Still client-side only, per Plan B spec §7.5 (no
 * server-side conversation persistence) -- and does not survive an app
 * restart, only in-session remounts (see `appStore.ts`'s `aiThreadsByService`
 * docstring). Each submitted question streams progress via `askKnowledge`'s
 * `onProgress` callback, then resolves into either an `answered` turn
 * (sentences with inline citation chips), a `noEvidence` turn, a `stopped`
 * turn (the user hit Stop), or — on any other rejected promise — an `error`
 * turn, so a failed ask never crashes the UI.
 */
/** `GET /api/ai/config`'s shape (only the fields this component reads). */
interface AiConfigResponse {
    backend?: 'cloud' | 'local';
    base_url?: string;
}

/** `GET /api/ai/usage`'s shape (only the fields this component reads). */
interface AiUsageResponse {
    model?: string;
    requestsToday?: number;
    dailyLimit?: number | null;
    estQuestionsLeft?: number | null;
}

export const AiFeature: React.FC = () => {
    const { t } = useTranslation();
    const activeService = useAppStore((state) => state.activeService);
    const threadsByService = useAppStore((state) => state.aiThreadsByService);
    const isAskingByService = useAppStore((state) => state.aiIsAsking);
    const appendAiTurns = useAppStore((state) => state.appendAiTurns);
    const replaceAiTurn = useAppStore((state) => state.replaceAiTurn);
    const clearAiThread = useAppStore((state) => state.clearAiThread);
    const setAiIsAsking = useAppStore((state) => state.setAiIsAsking);
    const setAiAbortController = useAppStore((state) => state.setAiAbortController);

    // Cloud-privacy consent gate (Product-wave Task 5, item 5): the backend
    // enforces this independently too (`cloud_consent_required` SSE error --
    // see `askErrorFields`/`ChatWindow`'s ErrorTurn), so a stale/raced value
    // here can never actually leak a question -- this is purely to show the
    // one-time modal BEFORE the network round-trip a doomed request would
    // otherwise cost.
    const [backendKind, setBackendKind] = useState<'cloud' | 'local' | null>(null);
    const [cloudProvider, setCloudProvider] = useState('the AI provider');
    const [consentGranted, setConsentGranted] = useState<boolean | null>(null);
    const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
    // Bumped after every ask settles so the usage snapshot below refetches
    // and reflects the just-recorded request instead of staying stale until
    // the next mount.
    const [usageRefreshKey, setUsageRefreshKey] = useState(0);

    // The ONE `/api/ai/usage` fetch for the whole chat surface (expert
    // review WIN 7i -- `UsageMeter` used to issue an identical duplicate
    // request per settle). This snapshot both GATES `sendQuestion` (quota
    // pre-empt, P-5 review item 2) and, passed down through `ChatWindow`,
    // RENDERS the composer's `UsageMeter`. Refetched on mount + after every
    // completed ask (`usageRefreshKey`) -- never per keystroke.
    const [usage, setUsage] = useState<AiUsageResponse | null>(null);

    useEffect(() => {
        fetch('/api/ai/usage')
            .then((res) => (res.ok ? res.json() : null))
            .then((data: AiUsageResponse | null) => setUsage(data))
            .catch((err: unknown) => {
                console.error('[AiFeature] Failed to fetch AI usage:', err);
            });
    }, [usageRefreshKey]);

    useEffect(() => {
        fetch('/api/ai/config')
            .then((res) => (res.ok ? res.json() : null))
            .then((data: AiConfigResponse | null) => {
                if (!data) return;
                if (data.backend === 'cloud' || data.backend === 'local') setBackendKind(data.backend);
                if (data.base_url) setCloudProvider(providerNameFromBaseUrl(data.base_url));
            })
            .catch((err: unknown) => {
                console.error('[AiFeature] Failed to fetch AI config:', err);
            });

        fetch('/api/ai/consent')
            .then((res) => (res.ok ? res.json() : null))
            .then((data: { granted?: boolean } | null) => {
                setConsentGranted(typeof data?.granted === 'boolean' ? data.granted : false);
            })
            .catch((err: unknown) => {
                console.error('[AiFeature] Failed to fetch cloud consent state:', err);
                setConsentGranted(false);
            });
    }, []);

    if (!activeService) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-500">
                {t('blogs.selectService')}
            </div>
        );
    }

    const turns = threadsByService[activeService] ?? [];
    const isAsking = isAskingByService[activeService] ?? false;

    const sendQuestion = (question: string) => {
        const service = activeService;
        const userId = nextTurnId();
        const assistantId = nextTurnId();
        const history = deriveHistory(threadsByService[service] ?? []);
        const now = Date.now();

        appendAiTurns(service, [
            { id: userId, role: 'user', text: question, createdAt: now },
            {
                id: assistantId,
                role: 'assistant',
                state: 'streaming',
                progressLabel: t('ai.thinking'),
                createdAt: now,
            },
        ]);
        setAiIsAsking(service, true);

        const controller = new AbortController();
        setAiAbortController(service, controller);

        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

        // Expert review WIN 1a: the backend heartbeats `progress` every ~1s
        // with an (almost always) UNCHANGED stage. Re-running `replaceAiTurn`
        // for those created a fresh turn object each time, re-rendering the
        // whole thread (and, before WIN 1b, re-triggering auto-scroll) once a
        // second for the entire 20-60s ask -- so skip the store write
        // entirely when the resolved label hasn't changed.
        let lastProgressLabel = t('ai.thinking');

        askKnowledge(
            service,
            question,
            tz,
            (label) => {
                const nextLabel = t(progressLabelKey(label));
                if (nextLabel === lastProgressLabel) return;
                lastProgressLabel = nextLabel;
                replaceAiTurn(service, assistantId, (turn) =>
                    turn.role === 'assistant' && turn.state === 'streaming'
                        ? { ...turn, progressLabel: nextLabel }
                        : turn
                );
            },
            { signal: controller.signal, history }
        )
            .then((answer) => {
                replaceAiTurn(service, assistantId, (turn) =>
                    answer.noEvidence
                        ? { id: assistantId, role: 'assistant', state: 'noEvidence', createdAt: turn.createdAt }
                        : { id: assistantId, role: 'assistant', state: 'answered', answer, createdAt: turn.createdAt }
                );
            })
            .catch((err: unknown) => {
                if (err instanceof AskError && err.code === 'aborted') {
                    // Stop button (Product-wave Task 6, item 2) -- a deliberate
                    // user action, never an error turn.
                    replaceAiTurn(service, assistantId, (turn) => ({
                        id: assistantId,
                        role: 'assistant',
                        state: 'stopped',
                        createdAt: turn.createdAt,
                    }));
                    return;
                }
                replaceAiTurn(service, assistantId, (turn) => ({
                    id: assistantId,
                    role: 'assistant',
                    state: 'error',
                    createdAt: turn.createdAt,
                    ...askErrorFields(err),
                }));
            })
            .finally(() => {
                setAiIsAsking(service, false);
                setAiAbortController(service, null);
                setUsageRefreshKey((k) => k + 1);
            });
    };

    /**
     * Pre-empts the ask entirely when the cloud backend already reports zero
     * estimated questions left for today (P-5 review, item 2) -- submitting
     * would just be a request we already know will come back
     * `quota_exhausted`. Synthesizes the SAME `error` turn shape a REAL SSE
     * `quota_exhausted` error would produce (`askErrorFields`'s shape), so
     * `ChatWindow` renders it with the existing `ai.error.quota_exhausted`
     * copy, the "Open AI settings" hint (`quota_exhausted` is already in
     * `SETTINGS_HINT_CODES`), AND `ai.quota.none`'s "switch to a local
     * model" wording -- no new UI/i18n needed, matching the existing
     * settings-hint pattern exactly rather than inventing a new one.
     * `askKnowledge` is never called; the composer stays enabled throughout
     * (this never sets any turn to `state: 'streaming'`).
     */
    const preemptQuotaExhausted = (question: string) => {
        const service = activeService;
        if (!service || !usage) return;
        const userId = nextTurnId();
        const assistantId = nextTurnId();
        const now = Date.now();
        appendAiTurns(service, [
            { id: userId, role: 'user', text: question, createdAt: now },
            {
                id: assistantId,
                role: 'assistant',
                state: 'error',
                code: 'quota_exhausted',
                message: 'quota exhausted -- pre-empted client-side, no request sent',
                backend: 'cloud',
                model: usage.model,
                requestsToday: usage.requestsToday,
                dailyLimit: usage.dailyLimit ?? undefined,
                estQuestionsLeft: usage.estQuestionsLeft ?? undefined,
                createdAt: now,
            },
        ]);
    };

    const handleSend = (question: string) => {
        if (backendKind === 'cloud' && usage?.estQuestionsLeft === 0) {
            preemptQuotaExhausted(question);
            return;
        }
        if (backendKind === 'cloud' && consentGranted === false) {
            // Ask stays UNSENT until the modal is resolved one way or another.
            setPendingQuestion(question);
            return;
        }
        sendQuestion(question);
    };

    const handleStop = () => {
        useAppStore.getState().aiAbortControllers[activeService]?.abort();
    };

    const handleClearThread = () => {
        clearAiThread(activeService);
    };

    const handleConsentAccept = () => {
        const question = pendingQuestion;
        setPendingQuestion(null);
        fetch('/api/ai/consent', { method: 'POST' })
            .then((res) => {
                if (res.ok) setConsentGranted(true);
            })
            .catch((err: unknown) => {
                console.error('[AiFeature] Failed to record cloud consent:', err);
            })
            .finally(() => {
                // Send regardless of whether the persist call itself
                // succeeded -- the backend enforces the SAME gate on `/ask`
                // independently, so a failed persist just means the user
                // sees the modal again next time, not a silently-lost ask.
                if (question) sendQuestion(question);
            });
    };

    const handleConsentDecline = () => {
        setPendingQuestion(null);
    };

    return (
        <>
            <ChatWindow
                turns={turns}
                onSend={handleSend}
                onStop={handleStop}
                onClearThread={handleClearThread}
                isAsking={isAsking}
                backendKind={backendKind}
                usage={usage}
            />
            <CloudConsentModal
                isOpen={pendingQuestion !== null}
                provider={cloudProvider}
                onAccept={handleConsentAccept}
                onDecline={handleConsentDecline}
            />
        </>
    );
};
