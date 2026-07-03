// frontend/src/features/ai/AiFeature.tsx
import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import { askKnowledge, providerNameFromBaseUrl } from './api';
import { ChatWindow } from './components/ChatWindow';
import type { ChatTurn } from './components/ChatWindow';
import { CloudConsentModal } from './components/CloudConsentModal';

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
 * `backend/api/ai.py`'s `_heartbeat_payload`); `verifying` is reserved for a
 * future, more granular per-tool-call progress hook (documented as a v1.1
 * item). An unrecognized or empty stage (e.g. `askKnowledge`'s `''` fallback
 * for a malformed payload) falls back to the generic "thinking" label so the
 * user never sees raw/untranslated text.
 */
const PROGRESS_LABEL_KEYS: Record<string, string> = {
    thinking: 'ai.thinking',
    verifying: 'ai.verifying',
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

/** Immutably replaces the turn with `id` within `service`'s thread. */
function replaceTurn(
    threads: Record<string, ChatTurn[]>,
    service: string,
    id: string,
    updater: (turn: ChatTurn) => ChatTurn
): Record<string, ChatTurn[]> {
    const existing = threads[service] ?? [];
    return {
        ...threads,
        [service]: existing.map((turn) => (turn.id === id ? updater(turn) : turn)),
    };
}

/**
 * `AiFeature` — the KB-chatbot chat UI. Mirrors `BlogsFeature`'s structure:
 * reads `activeService` from the app store, renders a "select a service"
 * placeholder when there isn't one.
 *
 * Chat history is local, per-service component state — client-side only,
 * per Plan B spec §7.5 (no server-side conversation persistence/store). Each
 * submitted question streams progress via `askKnowledge`'s `onProgress`
 * callback, then resolves into either an `answered` turn (sentences with
 * inline citation chips), a `noEvidence` turn, or — on a rejected promise —
 * an `error` turn, so a failed ask never crashes the UI.
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
    const [threadsByService, setThreadsByService] = useState<Record<string, ChatTurn[]>>({});

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
    // Bumped after every ask settles so `UsageMeter` (rendered by
    // `ChatWindow`) refetches `GET /api/ai/usage` and reflects the just-
    // recorded request instead of staying stale until the next mount.
    const [usageRefreshKey, setUsageRefreshKey] = useState(0);

    // Quota pre-empt (P-5 review, item 2): cached independently of
    // `UsageMeter`'s own fetch -- that one only RENDERS the meter; this one
    // GATES whether `sendQuestion` may even fire (see `handleSend`).
    // Refetched on the same triggers as the meter (`usageRefreshKey`: mount
    // + after every completed ask) -- never per keystroke, and never a
    // second fetch beyond what already happens on those triggers.
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
    const isStreaming = turns.some((turn) => turn.role === 'assistant' && turn.state === 'streaming');

    const sendQuestion = (question: string) => {
        const service = activeService;
        const userId = nextTurnId();
        const assistantId = nextTurnId();

        setThreadsByService((prev) => ({
            ...prev,
            [service]: [
                ...(prev[service] ?? []),
                { id: userId, role: 'user', text: question },
                { id: assistantId, role: 'assistant', state: 'streaming', progressLabel: t('ai.thinking') },
            ],
        }));

        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

        askKnowledge(service, question, tz, (label) => {
            setThreadsByService((prev) =>
                replaceTurn(prev, service, assistantId, (turn) =>
                    turn.role === 'assistant' && turn.state === 'streaming'
                        ? { ...turn, progressLabel: t(progressLabelKey(label)) }
                        : turn
                )
            );
        })
            .then((answer) => {
                setThreadsByService((prev) =>
                    replaceTurn(prev, service, assistantId, () =>
                        answer.noEvidence
                            ? { id: assistantId, role: 'assistant', state: 'noEvidence' }
                            : { id: assistantId, role: 'assistant', state: 'answered', answer }
                    )
                );
            })
            .catch((err: unknown) => {
                setThreadsByService((prev) =>
                    replaceTurn(prev, service, assistantId, () => ({
                        id: assistantId,
                        role: 'assistant',
                        state: 'error',
                        ...askErrorFields(err),
                    }))
                );
            })
            .finally(() => setUsageRefreshKey((k) => k + 1));
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
        setThreadsByService((prev) => ({
            ...prev,
            [service]: [
                ...(prev[service] ?? []),
                { id: userId, role: 'user', text: question },
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
                },
            ],
        }));
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
                disabled={isStreaming}
                backendKind={backendKind}
                usageRefreshKey={usageRefreshKey}
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
