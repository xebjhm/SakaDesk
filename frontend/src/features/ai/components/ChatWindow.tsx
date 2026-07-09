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
import { useAppStore } from '../../../store/appStore';
import { CitationChip } from './CitationChip';
import { SetupChecklist } from './SetupChecklist';
import { SuggestedQuestions } from './SuggestedQuestions';
import { UsageMeter } from './UsageMeter';
import type { UsageSnapshot } from './UsageMeter';
import { errorMessageKey } from '../aiErrorCode';
import type { AskCitation } from '../api';
import type { ChatTurn } from '../types';

export type { ChatTurn } from '../types';

// Codes whose fix is "go change something in AI settings" get an inline
// "Open AI settings" BUTTON (expert review WIN 2) wired to the app store's
// `openSettings('ai')` action -- `shell/App.tsx` + `SettingsModal` subscribe
// to the resulting `settingsRequest` and open the modal on the AI tab.
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

// A user within this many px of the message list's bottom counts as "pinned"
// -- only then does a turn update auto-scroll (expert review WIN 1: the old
// scroll-on-any-turns-change yanked the viewport on every 1s heartbeat).
const PIN_TO_BOTTOM_THRESHOLD_PX = 40;

// The member-name placeholder in `SuggestedQuestions` templates -- selected
// in the composer after a chip fills it, so typing replaces it (WIN 7h).
const SUGGESTED_PLACEHOLDER = '○○';

// How long the armed "Sure?" clear-confirm state lasts before auto-disarming
// (expert review WIN 5), and how long the Enter-while-asking hint shows.
const CLEAR_CONFIRM_TIMEOUT_MS = 3000;
const ASKING_HINT_TIMEOUT_MS = 2500;

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
    /** The caller's `/api/ai/usage` snapshot (refetched by `AiFeature` after
     * every settle), passed through to the composer's `UsageMeter` so the
     * meter never issues its own duplicate fetch (expert review WIN 7i).
     * `null` while still loading. */
    usage?: UsageSnapshot | null;
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

/**
 * Per-sentence citations, deduplicated by `docId` across the WHOLE answer
 * (expert review WIN 6): a doc cited by N sentences used to render N
 * identical pills. The first citing sentence keeps the chip; later
 * repetitions of the same doc render nothing.
 */
function dedupeSentenceCitations(
    sentences: { citationIds: string[] }[],
    citations: AskCitation[]
): AskCitation[][] {
    const seen = new Set<string>();
    return sentences.map((sentence) =>
        resolveCitations(sentence.citationIds, citations).filter((citation) => {
            if (seen.has(citation.docId)) return false;
            seen.add(citation.docId);
            return true;
        })
    );
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
    turns,
    onSend,
    onStop,
    onClearThread,
    isAsking = false,
    backendKind = null,
    usage = null,
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

    // Inline clear-conversation confirm (expert review WIN 5): first click
    // arms ("Sure?"), second click within the timeout actually clears.
    const [clearArmed, setClearArmed] = useState(false);
    const clearArmTimerRef = useRef<number | null>(null);

    // Transient "an answer is still in progress" hint, shown when Enter is
    // pressed while an ask is in flight (expert review WIN 7e -- it used to
    // be a silent no-op).
    const [showAskingHint, setShowAskingHint] = useState(false);
    const askingHintTimerRef = useRef<number | null>(null);

    useEffect(
        () => () => {
            if (clearArmTimerRef.current !== null) window.clearTimeout(clearArmTimerRef.current);
            if (askingHintTimerRef.current !== null) window.clearTimeout(askingHintTimerRef.current);
        },
        []
    );

    // ── Auto-scroll (expert review WIN 1) ────────────────────────────────
    // The backend heartbeats a progress event every ~1s for the whole
    // 20-60s ask; scrolling on ANY `turns` change yanked the viewport once
    // a second. Instead: track whether the user is pinned to the bottom
    // (onScroll), and key the effect on the thread's SHAPE (count + last
    // turn's id/state) rather than array identity, so an in-place progress
    // relabel never even fires it. Scroll only when a genuinely new turn
    // appends (the user just sent something) or when pinned.
    const pinnedToBottomRef = useRef(true);
    const prevTurnCountRef = useRef(0);
    const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
    const lastTurnId = lastTurn?.id ?? null;
    const lastTurnState = lastTurn && lastTurn.role === 'assistant' ? lastTurn.state : null;

    const handleScroll = () => {
        const el = scrollRef.current;
        if (!el) return;
        pinnedToBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < PIN_TO_BOTTOM_THRESHOLD_PX;
    };

    useEffect(() => {
        const appended = turns.length > prevTurnCountRef.current;
        prevTurnCountRef.current = turns.length;
        if (!appended && !pinnedToBottomRef.current) return;
        const el = scrollRef.current;
        if (!el) return;
        // jsdom (test environment) doesn't implement `Element.scrollTo`.
        if (typeof el.scrollTo === 'function') {
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        } else {
            el.scrollTop = el.scrollHeight;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [turns.length, lastTurnId, lastTurnState]);

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

    // Pending select-the-○○-placeholder range, applied after the picked
    // suggested question lands in the (controlled) textarea (WIN 7h) -- so
    // the user's next keystroke replaces the placeholder instead of
    // appending after it.
    const pendingSelectionRef = useRef<[number, number] | null>(null);
    useEffect(() => {
        const selection = pendingSelectionRef.current;
        if (!selection) return;
        pendingSelectionRef.current = null;
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(selection[0], selection[1]);
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
    // While `isAsking`, Enter doesn't submit (mirrors the Send button being
    // swapped for Stop) but is no longer SILENT (WIN 7e): a transient hint
    // explains that an answer is still in progress. The typed text is NOT
    // auto-submitted once the current answer settles: Send reappears and
    // the user must press Enter/Send again themselves.
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isAsking) {
                submitIfPossible();
                return;
            }
            setShowAskingHint(true);
            if (askingHintTimerRef.current !== null) window.clearTimeout(askingHintTimerRef.current);
            askingHintTimerRef.current = window.setTimeout(
                () => setShowAskingHint(false),
                ASKING_HINT_TIMEOUT_MS
            );
        }
    };

    const handleClearClick = () => {
        if (!clearArmed) {
            setClearArmed(true);
            if (clearArmTimerRef.current !== null) window.clearTimeout(clearArmTimerRef.current);
            clearArmTimerRef.current = window.setTimeout(
                () => setClearArmed(false),
                CLEAR_CONFIRM_TIMEOUT_MS
            );
            return;
        }
        if (clearArmTimerRef.current !== null) window.clearTimeout(clearArmTimerRef.current);
        setClearArmed(false);
        onClearThread?.();
    };

    // Quota de-dup (expert review WIN 4): while the NEWEST turn is a
    // quota-exhausted error, the bubble itself already says "no questions
    // left" -- repeating the identical `ai.quota.none` line in the meter
    // right below it is pure noise, so the meter hides for that beat.
    const newestTurnIsQuotaError =
        lastTurn?.role === 'assistant' &&
        lastTurn.state === 'error' &&
        lastTurn.code === 'quota_exhausted';

    return (
        <div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0">
                <Bot className="w-5 h-5 text-blue-500" />
                <h2 className="text-sm font-semibold text-gray-800">{t('ai.title')}</h2>
                <div className="ml-auto flex items-center gap-2">
                    {/* "Clear conversation" (Product-wave Task 6, item 1) -- only
                        meaningful once the thread has something in it. Two-step
                        inline confirm (WIN 5): arm, then clear -- no window.confirm. */}
                    {!isEmpty && onClearThread && (
                        <button
                            type="button"
                            onClick={handleClearClick}
                            aria-label={clearArmed ? t('ai.clearThreadConfirm') : t('ai.clearThread')}
                            title={clearArmed ? t('ai.clearThreadConfirm') : t('ai.clearThread')}
                            className={`flex items-center justify-center gap-1 h-7 rounded-full transition-colors ${
                                clearArmed
                                    ? 'px-2 text-red-600 bg-red-50 hover:bg-red-100'
                                    : 'w-7 text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                            }`}
                        >
                            <Trash2 className="w-3.5 h-3.5 shrink-0" />
                            {clearArmed && <span className="text-xs">{t('ai.clearThreadConfirm')}</span>}
                        </button>
                    )}
                    {/* Permanent Cloud/Local badge (Product-wave Task 5, item 5) --
                        slimmed to one word (WIN 7f); the privacy phrase lives in
                        the tooltip so the trust signal stays scannable. */}
                    {backendKind && (
                        <span
                            data-testid="ai-backend-badge"
                            title={t(backendKind === 'cloud' ? 'ai.badge.cloudTitle' : 'ai.badge.localTitle')}
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
            <div
                ref={scrollRef}
                onScroll={handleScroll}
                data-testid="ai-chat-scroll"
                className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
            >
                {isEmpty && (
                    <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 gap-3 px-6">
                        <Sparkles className="w-8 h-8" />
                        {/* WIN 7b: while setup still blocks the composer, "Ask me
                            anything" is a lie -- show a setup-oriented heading. */}
                        <p className="text-sm max-w-xs">
                            {setupReady ? t('ai.welcome') : t('ai.setupHeading')}
                        </p>
                        {!setupReady && <SetupChecklist onReady={() => setSetupReady(true)} />}
                        {setupReady && (
                            <SuggestedQuestions
                                onPick={(question) => {
                                    // Fill, don't send: the template's ○○
                                    // placeholder needs a real member name,
                                    // and a stray click must not spend cloud
                                    // quota (3-6 requests per ask). Select the
                                    // placeholder so typing replaces it (WIN 7h).
                                    const idx = question.indexOf(SUGGESTED_PLACEHOLDER);
                                    pendingSelectionRef.current =
                                        idx >= 0 ? [idx, idx + SUGGESTED_PLACEHOLDER.length] : null;
                                    setValue(question);
                                    textareaRef.current?.focus();
                                }}
                            />
                        )}
                    </div>
                )}

                {turns.map((turn) => (
                    <ChatTurnRow key={turn.id} turn={turn} modelFallback={usage?.model} />
                ))}
            </div>

            {/* Usage meter (Product-wave Task 5, item 3) -- renders nothing
                when the configured model has no daily limit, and hides
                entirely while the newest turn is a quota error (WIN 4: the
                bubble already carries the exact same guidance). */}
            {!newestTurnIsQuotaError && (
                <div className="px-4 pt-2 shrink-0">
                    <UsageMeter usage={usage} />
                </div>
            )}

            {/* Enter-while-asking hint (WIN 7e). */}
            {showAskingHint && (
                <div
                    data-testid="ai-asking-hint"
                    aria-live="polite"
                    className="px-4 pt-1 text-[11px] text-gray-400 shrink-0"
                >
                    {t('ai.askingHint')}
                </div>
            )}

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
                        title={t('ai.stop')}
                        className="w-9 h-9 shrink-0 rounded-full bg-gray-500 text-white flex items-center justify-center hover:bg-gray-600 transition-colors"
                    >
                        <Square className="w-3.5 h-3.5" fill="currentColor" />
                    </button>
                ) : (
                    <button
                        type="submit"
                        disabled={sendDisabled}
                        aria-label={t('ai.send')}
                        title={t('ai.send')}
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

const ChatTurnRow: React.FC<{ turn: ChatTurn; modelFallback?: string }> = ({
    turn,
    modelFallback,
}) => {
    const { t } = useTranslation();
    const openSettings = useAppStore((s) => s.openSettings);

    if (turn.role === 'user') {
        return (
            <div className="flex flex-col items-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-blue-500 text-white px-4 py-2 text-sm whitespace-pre-wrap break-words">
                    {turn.text}
                </div>
                {/* gray-500, not gray-300: the lighter shade failed contrast
                    on white (WIN 7g). */}
                <span className="text-[10px] text-gray-500 mt-0.5 pr-1">{formatTurnTime(turn.createdAt)}</span>
            </div>
        );
    }

    // Assistant turns share a left-aligned bubble shell with a Bot avatar;
    // only the inner bubble's content/styling varies by state. The wrapper's
    // `title` is the hover timestamp (WIN 7g) -- assistant turns don't
    // carry a visible one.
    return (
        <div className="flex items-start gap-2">
            <div className="w-7 h-7 shrink-0 rounded-full bg-blue-50 flex items-center justify-center">
                <Bot className="w-4 h-4 text-blue-500" />
            </div>
            <div className="max-w-[80%] min-w-0" title={formatTurnTime(turn.createdAt)}>
                {turn.state === 'streaming' && (
                    <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-gray-100 text-gray-500 px-4 py-2 text-sm">
                        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                        {turn.progressLabel}
                    </div>
                )}

                {turn.state === 'answered' && (
                    <div className="flex items-start gap-1">
                        <div className="rounded-2xl rounded-tl-sm bg-gray-100 text-gray-800 px-4 py-2 text-sm leading-relaxed">
                            {dedupeSentenceCitations(turn.answer.sentences, turn.answer.citations).map(
                                (sentenceCitations, i) => (
                                    <span key={i}>
                                        {turn.answer.sentences[i].text}{' '}
                                        {sentenceCitations.map((citation) => (
                                            <CitationChip key={citation.docId} citation={citation} />
                                        ))}{' '}
                                    </span>
                                )
                            )}
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
                    "open settings" action, distinct from the red error state below. */}
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
                                // WIN 7a: `{{model}}` must never interpolate
                                // empty -- prefer the turn's own model, then
                                // the current usage snapshot's, then a word.
                                model: turn.model || modelFallback || t('ai.error.modelFallback'),
                                backend: turn.backend ?? '',
                            })}
                        </div>
                        {/* WIN 4: a quota turn renders exactly ONE guidance line
                            (the message above -- which already says "try again
                            later / switch models") + one action (the settings
                            button below). The old retry-after + quota-left +
                            hint stack is gone for that code. */}
                        {turn.code !== 'quota_exhausted' && typeof turn.retryAfterS === 'number' && (
                            <div className="pl-6 text-xs text-red-600/80">
                                {t('ai.error.retryAfter', { seconds: Math.ceil(turn.retryAfterS) })}
                            </div>
                        )}
                        {SETTINGS_HINT_CODES.has(turn.code) && (
                            <div className="pl-6">
                                <button
                                    type="button"
                                    onClick={() => openSettings('ai')}
                                    className="text-xs font-medium text-red-700 underline underline-offset-2 hover:text-red-800"
                                >
                                    {t('ai.error.openSettingsAction')}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
