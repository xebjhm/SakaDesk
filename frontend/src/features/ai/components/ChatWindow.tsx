// frontend/src/features/ai/components/ChatWindow.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
    AlertCircle,
    Bot,
    Check,
    Cloud,
    Copy,
    HardDrive,
    Loader2,
    Send,
    Sparkles,
    SearchX,
    Square,
    StopCircle,
    Trash2,
} from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { CitationChip } from './CitationChip';
import { SetupChecklist } from './SetupChecklist';
import { UsageMeter } from './UsageMeter';
import { errorMessageKey } from '../aiErrorCode';
import type { AskCitation } from '../api';
import type { ChatTurn } from '../types';

export type { ChatTurn } from '../types';

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
    'cloud_consent_required',
]);

// Auto-growing composer textarea (Product-wave Task 6, item 4): grows with
// content up to this height, then scrolls internally.
const COMPOSER_MAX_HEIGHT_PX = 160;

interface ChatWindowProps {
    turns: ChatTurn[];
    onSend: (question: string) => void;
    /** Stop button handler (Product-wave Task 6, item 2) -- aborts the
     * in-flight ask. Only ever invoked while `isAsking` is true. */
    onStop?: () => void;
    /** "Clear conversation" button handler (Product-wave Task 6, item 1). */
    onClearThread?: () => void;
    /** True while an ask is in flight for the active service -- swaps the
     * Send button for Stop. The composer's TEXT INPUT itself stays enabled
     * throughout (Product-wave Task 6, item 4: only Send/Stop gates). */
    isAsking?: boolean;
    /** The currently-configured `knowledge_base.llm.backend` (Product-wave
     * Task 5, item 5) — drives the permanent Cloud/Local header badge.
     * `null`/`undefined` while `AiFeature` hasn't fetched `/api/ai/config`
     * yet — the badge simply doesn't render until it's known. */
    backendKind?: 'cloud' | 'local' | null;
    /** Bumped by `AiFeature` after every ask settles so the composer's
     * `UsageMeter` refetches and reflects the just-recorded request. */
    usageRefreshKey?: number;
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

export const ChatWindow: React.FC<ChatWindowProps> = ({
    turns,
    onSend,
    onStop,
    onClearThread,
    isAsking = false,
    backendKind = null,
    usageRefreshKey,
}) => {
    const { t } = useTranslation();
    const [value, setValue] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    // Product-wave Task 6, item 4: the TEXT INPUT only ever gates on setup --
    // an in-flight ask (`isAsking`) no longer disables typing, only Send.
    const composerDisabled = setupBlocking;
    const sendDisabled = composerDisabled || !value.trim();

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

    // Auto-grow the composer textarea with its content (Product-wave Task 6,
    // item 4), capped at `COMPOSER_MAX_HEIGHT_PX` (scrolls internally past
    // that). jsdom reports `scrollHeight` as 0, so this is a no-op there --
    // never throws, just has nothing visible to assert in tests.
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
    }, [value]);

    const submitIfPossible = () => {
        const question = value.trim();
        if (!question || sendDisabled) return;
        onSend(question);
        setValue('');
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        submitIfPossible();
    };

    // Enter = send, Shift+Enter = newline (Product-wave Task 6, item 4).
    // While `isAsking`, Enter is a no-op (mirrors the Send button being
    // swapped for Stop) -- but the user can still keep TYPING their next
    // question, which submits the moment the current answer settles and
    // Send reappears.
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isAsking) submitIfPossible();
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0">
                <Bot className="w-5 h-5 text-blue-500" />
                <h2 className="text-sm font-semibold text-gray-800">{t('ai.title')}</h2>
                <div className="ml-auto flex items-center gap-2">
                    {/* "Clear conversation" (Product-wave Task 6, item 1) -- only
                        meaningful once the thread has something in it. */}
                    {!isEmpty && onClearThread && (
                        <button
                            type="button"
                            onClick={onClearThread}
                            aria-label={t('ai.clearThread')}
                            title={t('ai.clearThread')}
                            className="flex items-center justify-center w-7 h-7 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    )}
                    {/* Permanent Cloud/Local badge (Product-wave Task 5, item 5) --
                        "data leaves this device" vs "on-device", so the trust
                        signal is visible on every turn, not just at consent time. */}
                    {backendKind && (
                        <span
                            data-testid="ai-backend-badge"
                            className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${
                                backendKind === 'cloud'
                                    ? 'bg-amber-50 text-amber-700'
                                    : 'bg-green-50 text-green-700'
                            }`}
                        >
                            {backendKind === 'cloud' ? (
                                <Cloud className="w-3 h-3" />
                            ) : (
                                <HardDrive className="w-3 h-3" />
                            )}
                            {t(backendKind === 'cloud' ? 'ai.badge.cloud' : 'ai.badge.local')}
                        </span>
                    )}
                </div>
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

            {/* Usage meter (Product-wave Task 5, item 3) -- renders nothing
                when the configured model has no daily limit. */}
            <div className="px-4 pt-2 shrink-0">
                <UsageMeter refreshKey={usageRefreshKey} />
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="flex items-end gap-2 px-4 py-3 border-t border-gray-100 shrink-0">
                <textarea
                    ref={textareaRef}
                    rows={1}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={setupBlocking ? t('ai.setupRequiredPlaceholder') : t('ai.placeholder')}
                    disabled={composerDisabled}
                    style={{ maxHeight: COMPOSER_MAX_HEIGHT_PX }}
                    className="flex-1 resize-none text-sm bg-gray-100/60 rounded-2xl px-4 py-2 outline-none placeholder-gray-400 disabled:opacity-60 overflow-y-auto"
                />
                {isAsking ? (
                    <button
                        type="button"
                        onClick={onStop}
                        aria-label={t('ai.stop')}
                        className="w-9 h-9 shrink-0 rounded-full bg-gray-500 text-white flex items-center justify-center hover:bg-gray-600 transition-colors"
                    >
                        <Square className="w-3.5 h-3.5" fill="currentColor" />
                    </button>
                ) : (
                    <button
                        type="submit"
                        disabled={sendDisabled}
                        aria-label={t('ai.send')}
                        className="w-9 h-9 shrink-0 rounded-full bg-blue-500 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-600 transition-colors"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                )}
            </form>
        </div>
    );
};

/** `turn.createdAt` (epoch ms) as a short localized clock time, for the
 * small timestamp under each bubble. */
function formatTurnTime(createdAt: number): string {
    return new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Plain-text form of an answered turn (sentences only, no citations) --
 * shared by the copy button and, via `../AiFeature.tsx`'s `deriveHistory`,
 * multi-turn history construction. */
function answerPlainText(turn: Extract<ChatTurn, { state: 'answered' }>): string {
    return turn.answer.sentences.map((s) => s.text).join(' ');
}

const CopyAnswerButton: React.FC<{ turn: Extract<ChatTurn, { state: 'answered' }> }> = ({ turn }) => {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        const text = answerPlainText(turn);
        // `navigator.clipboard` isn't implemented in every environment (e.g.
        // jsdom under test, or a non-HTTPS/insecure context) -- guard rather
        // than let a missing API crash the click handler.
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).catch(() => {
                // Best-effort UX affordance; a failed copy isn't worth
                // surfacing as an error turn.
            });
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };

    return (
        <button
            type="button"
            onClick={handleCopy}
            aria-label={t(copied ? 'ai.copied' : 'ai.copyAnswer')}
            title={t('ai.copyAnswer')}
            className="mt-1 flex items-center justify-center w-6 h-6 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
    );
};

const ChatTurnRow: React.FC<{ turn: ChatTurn }> = ({ turn }) => {
    const { t } = useTranslation();

    if (turn.role === 'user') {
        return (
            <div className="flex flex-col items-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-500 text-white px-4 py-2 text-sm whitespace-pre-wrap break-words">
                    {turn.text}
                </div>
                <span className="text-[10px] text-gray-300 mt-0.5 pr-1">{formatTurnTime(turn.createdAt)}</span>
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
                    <div className="flex items-start gap-1">
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
                        <CopyAnswerButton turn={turn} />
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

                {/* Stop button result (Product-wave Task 6, item 2): a deliberate
                    user action, not a failure -- neutral gray styling, no
                    "open settings" hint, distinct from the red error state below. */}
                {turn.state === 'stopped' && (
                    <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-gray-100 border border-gray-200 text-gray-500 px-4 py-2 text-sm">
                        <StopCircle className="w-4 h-4 shrink-0" />
                        {t('ai.stopped')}
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
                        {/* Usage-meter numbers a `quota_exhausted` error is enriched
                            with (Product-wave Task 5, item 3) -- reconciles the
                            composer's meter with the REAL 429 that just landed. */}
                        {turn.code === 'quota_exhausted' && typeof turn.estQuestionsLeft === 'number' && (
                            <div className="pl-6 text-xs text-red-600/80">
                                {turn.estQuestionsLeft > 0
                                    ? t('ai.quota.left', { count: turn.estQuestionsLeft })
                                    : t('ai.quota.none')}
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
