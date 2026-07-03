// frontend/src/features/ai/components/ChatWindow.tsx
import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Bot, Loader2, Send, Sparkles, SearchX } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { CitationChip } from './CitationChip';
import { SetupChecklist } from './SetupChecklist';
import type { AskAnswer, AskCitation } from '../api';

/**
 * One turn in the local, per-service chat thread (client-side only — no
 * server-side conversation persistence, per Plan B spec §7.5).
 *
 * An error turn's `code` is `AskError.code` (see `../api.ts`) — the stable
 * taxonomy `errorMessageKey` maps to a localized `ai.error.<code>` message.
 * `message` is kept only as the non-localized fallback for `console.error`/
 * debugging, never rendered directly (see `ChatTurnRow`).
 */
export type ChatTurn =
    | { id: string; role: 'user'; text: string }
    | { id: string; role: 'assistant'; state: 'streaming'; progressLabel: string }
    | { id: string; role: 'assistant'; state: 'answered'; answer: AskAnswer }
    | { id: string; role: 'assistant'; state: 'noEvidence' }
    | {
          id: string;
          role: 'assistant';
          state: 'error';
          code: string;
          message: string;
          retryAfterS?: number;
          backend?: string;
          model?: string;
      };

// Known `ai.error.*` codes — an unrecognized/absent code falls back to
// `ai.error.unknown` so the user never sees a raw/untranslated string.
const KNOWN_AI_ERROR_CODES = new Set([
    'quota_exhausted',
    'auth',
    'model_not_found',
    'model_incompatible',
    'unreachable',
    'timeout',
    'malformed_response',
    'misconfigured',
    'kb_disabled',
    'embedding_model_missing',
    'network',
]);

function errorMessageKey(code: string): string {
    return `ai.error.${KNOWN_AI_ERROR_CODES.has(code) ? code : 'unknown'}`;
}

// Codes whose fix is "go change something in AI settings" get the inline
// "Open AI settings" hint. No clean hook to actually OPEN the settings modal
// reaches this deep (it's local state in `shell/App.tsx`'s `useSettings`,
// not exposed via the app store or a context) — see Plan B Task 1's report
// for the follow-up — so this renders as hint TEXT, not a button, for now.
const SETTINGS_HINT_CODES = new Set([
    'quota_exhausted',
    'auth',
    'misconfigured',
    'kb_disabled',
    'model_not_found',
    'model_incompatible',
    'embedding_model_missing',
]);

interface ChatWindowProps {
    turns: ChatTurn[];
    onSend: (question: string) => void;
    /** True while the latest turn is still streaming — disables the input
     * so a second question can't be submitted mid-ask. */
    disabled?: boolean;
}

/**
 * Resolves a sentence's `citationIds` (backend `doc_id`s — see
 * `pysaka.knowledge.models.AnswerSentence.citation_ids`) against the
 * answer's `citations` array so each cited sentence can render its
 * `CitationChip`s inline. An id with no matching citation is silently
 * skipped (defensive — shouldn't happen given server-side grounding
 * validation, but a missing chip is a better failure mode than a crash).
 */
function resolveCitations(citationIds: string[], citations: AskCitation[]): AskCitation[] {
    const byDocId = new Map(citations.map((c) => [c.docId, c]));
    return citationIds
        .map((id) => byDocId.get(id))
        .filter((c): c is AskCitation => c !== undefined);
}

export const ChatWindow: React.FC<ChatWindowProps> = ({ turns, onSend, disabled = false }) => {
    const { t } = useTranslation();
    const [value, setValue] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);

    // First-run provisioning gate (Product-wave Task 4, item 3): while the
    // thread is empty and `/api/ai/readiness` hasn't yet confirmed the KB is
    // fully configured, the `SetupChecklist` replaces the plain welcome copy
    // and the input stays disabled with an explanatory placeholder -- this
    // is what replaces the old, misleading "0 documents indexed" the user
    // used to see with zero explanation. Once `SetupChecklist` reports ready
    // (or the thread already has turns, i.e. a previous ask already
    // succeeded), the normal empty-state/input behavior applies.
    const [setupReady, setSetupReady] = useState(false);
    const isEmpty = turns.length === 0;
    const setupBlocking = isEmpty && !setupReady;
    const inputDisabled = disabled || setupBlocking;

    // Auto-scroll to the latest turn whenever the thread changes. jsdom (test
    // environment) doesn't implement `Element.scrollTo`, so guard for it.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        if (typeof el.scrollTo === 'function') {
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        } else {
            el.scrollTop = el.scrollHeight;
        }
    }, [turns]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const question = value.trim();
        if (!question || inputDisabled) return;
        onSend(question);
        setValue('');
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0">
                <Bot className="w-5 h-5 text-blue-500" />
                <h2 className="text-sm font-semibold text-gray-800">{t('ai.title')}</h2>
            </div>

            {/* Message list */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {isEmpty && (
                    <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 gap-3 px-6">
                        <Sparkles className="w-8 h-8" />
                        <p className="text-sm max-w-xs">{t('ai.welcome')}</p>
                        {!setupReady && <SetupChecklist onReady={() => setSetupReady(true)} />}
                    </div>
                )}

                {turns.map((turn) => (
                    <ChatTurnRow key={turn.id} turn={turn} />
                ))}
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 shrink-0">
                <input
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={setupBlocking ? t('ai.setupRequiredPlaceholder') : t('ai.placeholder')}
                    disabled={inputDisabled}
                    className="flex-1 text-sm bg-gray-100/60 rounded-full px-4 py-2 outline-none placeholder-gray-400 disabled:opacity-60"
                />
                <button
                    type="submit"
                    disabled={inputDisabled || !value.trim()}
                    aria-label={t('ai.send')}
                    className="w-9 h-9 shrink-0 rounded-full bg-blue-500 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-600 transition-colors"
                >
                    <Send className="w-4 h-4" />
                </button>
            </form>
        </div>
    );
};

const ChatTurnRow: React.FC<{ turn: ChatTurn }> = ({ turn }) => {
    const { t } = useTranslation();

    if (turn.role === 'user') {
        return (
            <div className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-500 text-white px-4 py-2 text-sm whitespace-pre-wrap break-words">
                    {turn.text}
                </div>
            </div>
        );
    }

    // Assistant turns share a left-aligned bubble shell with a Bot avatar;
    // only the inner bubble's content/styling varies by state.
    return (
        <div className="flex items-start gap-2">
            <div className="w-7 h-7 shrink-0 rounded-full bg-blue-50 flex items-center justify-center">
                <Bot className="w-4 h-4 text-blue-500" />
            </div>
            <div className="max-w-[80%] min-w-0">
                {turn.state === 'streaming' && (
                    <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-gray-100 text-gray-500 px-4 py-2 text-sm">
                        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                        {turn.progressLabel}
                    </div>
                )}

                {turn.state === 'answered' && (
                    <div className="rounded-2xl rounded-tl-sm bg-gray-100 text-gray-800 px-4 py-2 text-sm leading-relaxed">
                        {turn.answer.sentences.map((sentence, i) => (
                            <span key={i}>
                                {sentence.text}{' '}
                                {resolveCitations(sentence.citationIds, turn.answer.citations).map((citation, j) => (
                                    <CitationChip key={`${citation.docId}-${j}`} citation={citation} />
                                ))}{' '}
                            </span>
                        ))}
                    </div>
                )}

                {/* "No evidence" is a distinct, non-error state — amber/informational,
                    never the red error styling below. */}
                {turn.state === 'noEvidence' && (
                    <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-amber-50 border border-amber-200 text-amber-700 px-4 py-2 text-sm">
                        <SearchX className="w-4 h-4 shrink-0" />
                        {t('ai.noEvidence')}
                    </div>
                )}

                {turn.state === 'error' && (
                    <div className="flex flex-col gap-1 rounded-2xl rounded-tl-sm bg-red-50 border border-red-200 text-red-700 px-4 py-2 text-sm">
                        <div className="flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            {t(errorMessageKey(turn.code), {
                                model: turn.model ?? '',
                                backend: turn.backend ?? '',
                            })}
                        </div>
                        {typeof turn.retryAfterS === 'number' && (
                            <div className="pl-6 text-xs text-red-600/80">
                                {t('ai.error.retryAfter', { seconds: Math.ceil(turn.retryAfterS) })}
                            </div>
                        )}
                        {SETTINGS_HINT_CODES.has(turn.code) && (
                            <div className="pl-6 text-xs text-red-600/80">
                                {t('ai.error.openSettingsHint')}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
