// frontend/src/features/ai/AiFeature.tsx
import React, { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import { askKnowledge } from './api';
import { ChatWindow } from './components/ChatWindow';
import type { ChatTurn } from './components/ChatWindow';

// Monotonic id generator for chat turns — deterministic and dependency-free
// (no crypto.randomUUID needed for a purely local, non-persisted thread).
let turnCounter = 0;
function nextTurnId(): string {
    turnCounter += 1;
    return `turn-${Date.now()}-${turnCounter}`;
}

/**
 * Known `event: progress` stage codes -> i18n key. Today the backend only
 * ever emits `{stage: "thinking"}` (see `backend/api/ai.py`'s
 * `_ask_event_stream` heartbeat) — `verifying` is reserved for a future,
 * more granular per-tool-call progress hook (documented as a v1.1 item).
 * An unrecognized or empty stage (e.g. `askKnowledge`'s `''` fallback for a
 * malformed payload) falls back to the generic "thinking" label so the user
 * never sees raw/untranslated text.
 */
const PROGRESS_LABEL_KEYS: Record<string, string> = {
    thinking: 'ai.thinking',
    verifying: 'ai.verifying',
};

function progressLabelKey(stage: string): string {
    return PROGRESS_LABEL_KEYS[stage] ?? 'ai.thinking';
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
export const AiFeature: React.FC = () => {
    const { t } = useTranslation();
    const activeService = useAppStore((state) => state.activeService);
    const [threadsByService, setThreadsByService] = useState<Record<string, ChatTurn[]>>({});

    if (!activeService) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-500">
                {t('blogs.selectService')}
            </div>
        );
    }

    const turns = threadsByService[activeService] ?? [];
    const isStreaming = turns.some((turn) => turn.role === 'assistant' && turn.state === 'streaming');

    const handleSend = (question: string) => {
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
                        message: err instanceof Error ? err.message : String(err),
                    }))
                );
            });
    };

    return <ChatWindow turns={turns} onSend={handleSend} disabled={isStreaming} />;
};
