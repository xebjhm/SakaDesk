// frontend/src/features/ai/__tests__/ChatWindow.test.tsx
//
// Direct `ChatWindow` unit tests for the expert-review UX wins:
//   WIN 1b -- pinned-aware auto-scroll (no more 1Hz heartbeat scroll hijack)
//   WIN 2  -- "Open AI settings" error action dispatches openSettings('ai')
//   WIN 3  -- runtime_missing renders its own friendly copy
//   WIN 4  -- quota errors: one guidance line + one action, meter hidden
//   WIN 5  -- inline two-step clear-conversation confirm
//   WIN 6  -- citation chips dedupe by docId across the whole answer
//   WIN 7  -- copy/polish batch (setup heading, model fallback, asking hint,
//             hover timestamps)
// The ask-flow integration (store + SSE) lives in `AiFeature.test.tsx`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ChatWindow } from '../components/ChatWindow';
import type { ChatTurn } from '../types';
import type { AskAnswer, AskCitation } from '../api';
import { useAppStore } from '../../../store/appStore';

const noop = () => {};

function userTurn(id: string, createdAt = 1000): ChatTurn {
    return { id, role: 'user', text: `question ${id}`, createdAt };
}

function streamingTurn(id: string, progressLabel = 'Thinking…'): ChatTurn {
    return { id, role: 'assistant', state: 'streaming', progressLabel, createdAt: 2000 };
}

function stoppedTurn(id: string): ChatTurn {
    return { id, role: 'assistant', state: 'stopped', createdAt: 2000 };
}

function errorTurn(id: string, code: string, extra: Partial<Extract<ChatTurn, { state: 'error' }>> = {}): ChatTurn {
    return { id, role: 'assistant', state: 'error', code, message: 'raw', createdAt: 2000, ...extra };
}

function citation(docId: string): AskCitation {
    return {
        docId,
        ref: {
            type: 'message',
            service: 'hinatazaka46',
            groupId: 1,
            groupName: 'group',
            memberId: 2,
            memberName: 'member-name',
            messageId: 42,
            isGroupChat: true,
        },
        snippet: 'snippet',
        member: 'member-name',
        timestamp: '2026-06-30T12:00:00+00:00',
    };
}

function answeredTurn(id: string, answer: AskAnswer): ChatTurn {
    return { id, role: 'assistant', state: 'answered', answer, createdAt: 2000 };
}

describe('ChatWindow', () => {
    beforeEach(() => {
        useAppStore.setState({ settingsRequest: null });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    describe('auto-scroll (expert review WIN 1b)', () => {
        function getScroller(): HTMLElement {
            return screen.getByTestId('ai-chat-scroll');
        }

        /** Attach a `scrollTo` spy AFTER mount, so only post-mount effect
         * runs are observed (jsdom has no native `scrollTo`; the component
         * falls back to a `scrollTop` write on mount). */
        function spyScrollTo(el: HTMLElement) {
            const spy = vi.fn();
            (el as HTMLElement & { scrollTo: typeof spy }).scrollTo = spy;
            return spy;
        }

        /** Simulate the user having scrolled well away from the bottom. */
        function scrollAwayFromBottom(el: HTMLElement) {
            Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
            Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true });
            el.scrollTop = 100; // 600px from the bottom -- well past the pin threshold
            fireEvent.scroll(el);
        }

        it('does not scroll when the turns array changes identity but the thread shape is unchanged (heartbeat)', () => {
            const { rerender } = render(
                <ChatWindow turns={[userTurn('u1'), streamingTurn('a1')]} onSend={noop} />
            );
            const spy = spyScrollTo(getScroller());

            // New array + new turn objects, same id/state/label -- exactly
            // what a 1s heartbeat used to produce before WIN 1a.
            rerender(<ChatWindow turns={[userTurn('u1'), streamingTurn('a1')]} onSend={noop} />);
            // Even a progress RELABEL (thinking -> indexing) must not scroll.
            rerender(
                <ChatWindow
                    turns={[userTurn('u1'), streamingTurn('a1', 'Indexing your data…')]}
                    onSend={noop}
                />
            );

            expect(spy).not.toHaveBeenCalled();
        });

        it('does not scroll when the user has scrolled up, even as the streaming turn settles', () => {
            const { rerender } = render(
                <ChatWindow turns={[userTurn('u1'), streamingTurn('a1')]} onSend={noop} />
            );
            const scroller = getScroller();
            scrollAwayFromBottom(scroller);
            const spy = spyScrollTo(scroller);

            // Terminal-state transition on the SAME turn (no append) while
            // unpinned: the user is reading history -- leave them alone.
            rerender(<ChatWindow turns={[userTurn('u1'), stoppedTurn('a1')]} onSend={noop} />);

            expect(spy).not.toHaveBeenCalled();
        });

        it('scrolls when a genuinely new turn appends while pinned to the bottom', () => {
            const { rerender } = render(
                <ChatWindow turns={[userTurn('u1'), stoppedTurn('a1')]} onSend={noop} />
            );
            const spy = spyScrollTo(getScroller());

            rerender(
                <ChatWindow
                    turns={[userTurn('u1'), stoppedTurn('a1'), userTurn('u2'), streamingTurn('a2')]}
                    onSend={noop}
                />
            );

            expect(spy).toHaveBeenCalled();
        });

        it('scrolls when the streaming turn settles into an answer while pinned', () => {
            const { rerender } = render(
                <ChatWindow turns={[userTurn('u1'), streamingTurn('a1')]} onSend={noop} />
            );
            const spy = spyScrollTo(getScroller());

            rerender(<ChatWindow turns={[userTurn('u1'), stoppedTurn('a1')]} onSend={noop} />);

            expect(spy).toHaveBeenCalled();
        });
    });

    describe('"Open AI settings" error action (expert review WIN 2)', () => {
        it('dispatches openSettings("ai") through the app store', () => {
            render(<ChatWindow turns={[userTurn('u1'), errorTurn('a1', 'auth')]} onSend={noop} />);

            fireEvent.click(screen.getByRole('button', { name: 'Open AI settings' }));

            expect(useAppStore.getState().settingsRequest).toEqual({ tab: 'ai' });
        });
    });

    describe('runtime_missing error code (expert review WIN 3)', () => {
        it('renders the friendly "setting up the AI engine" copy, not the generic fallback', () => {
            render(
                <ChatWindow turns={[userTurn('u1'), errorTurn('a1', 'runtime_missing')]} onSend={noop} />
            );

            expect(
                screen.getByText(
                    'Setting up the AI engine for the first time — this can take a minute. Try again shortly.'
                )
            ).toBeInTheDocument();
            expect(
                screen.queryByText('Something went wrong answering that. Please try again.')
            ).toBeNull();
        });
    });

    describe('quota de-dup (expert review WIN 4)', () => {
        const EXHAUSTED_USAGE = { model: 'gemini-2.5-flash', requestsToday: 20, dailyLimit: 20, estQuestionsLeft: 0 };

        it('hides the usage meter while the newest turn is a quota error', () => {
            render(
                <ChatWindow
                    turns={[userTurn('u1'), errorTurn('a1', 'quota_exhausted', { model: 'gemini-2.5-flash' })]}
                    onSend={noop}
                    usage={EXHAUSTED_USAGE}
                />
            );

            expect(screen.queryByTestId('usage-meter')).toBeNull();
            // The bubble carries the single guidance line + single action.
            expect(screen.getByText(/usage limit/i)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Open AI settings' })).toBeInTheDocument();
            expect(
                screen.queryByText('No questions left today — try again tomorrow, or switch to a local model.')
            ).toBeNull();
        });

        it('shows the meter again once a newer non-quota turn exists', () => {
            render(
                <ChatWindow
                    turns={[
                        userTurn('u1'),
                        errorTurn('a1', 'quota_exhausted', { model: 'gemini-2.5-flash' }),
                        userTurn('u2'),
                        stoppedTurn('a2'),
                    ]}
                    onSend={noop}
                    usage={EXHAUSTED_USAGE}
                />
            );

            expect(screen.getByTestId('usage-meter')).toBeInTheDocument();
        });
    });

    describe('inline clear-conversation confirm (expert review WIN 5)', () => {
        it('arms on the first click and only clears on the second', () => {
            const onClearThread = vi.fn();
            render(
                <ChatWindow turns={[userTurn('u1')]} onSend={noop} onClearThread={onClearThread} />
            );

            fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }));
            expect(onClearThread).not.toHaveBeenCalled();
            expect(screen.getByText('Sure?')).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', { name: 'Sure?' }));
            expect(onClearThread).toHaveBeenCalledTimes(1);
            // Disarmed again after clearing.
            expect(screen.queryByText('Sure?')).toBeNull();
        });

        it('auto-disarms after the timeout without clearing', () => {
            vi.useFakeTimers();
            const onClearThread = vi.fn();
            render(
                <ChatWindow turns={[userTurn('u1')]} onSend={noop} onClearThread={onClearThread} />
            );

            fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }));
            expect(screen.getByText('Sure?')).toBeInTheDocument();

            act(() => {
                vi.advanceTimersByTime(3000);
            });

            expect(screen.queryByText('Sure?')).toBeNull();
            expect(onClearThread).not.toHaveBeenCalled();
            // The next click arms again rather than clearing.
            fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }));
            expect(onClearThread).not.toHaveBeenCalled();
        });
    });

    describe('citation dedupe (expert review WIN 6)', () => {
        it('renders one chip per unique docId across the whole answer, kept at the first citing sentence', () => {
            const answer: AskAnswer = {
                sentences: [
                    { text: 'First sentence.', citationIds: ['doc-1'] },
                    { text: 'Second sentence.', citationIds: ['doc-1'] },
                    { text: 'Third sentence.', citationIds: ['doc-1', 'doc-2'] },
                ],
                citations: [citation('doc-1'), citation('doc-2')],
                noEvidence: false,
            };
            render(<ChatWindow turns={[userTurn('u1'), answeredTurn('a1', answer)]} onSend={noop} />);

            // doc-1 cited by all three sentences -> exactly ONE chip for it,
            // plus one for doc-2 = two chips total.
            const chips = screen.getAllByRole('button', { name: /Source: member-name/ });
            expect(chips).toHaveLength(2);
            // The doc-1 chip sits with the FIRST sentence (document order:
            // its chip precedes the second sentence's text node).
            const firstChip = chips[0];
            const secondSentence = screen.getByText('Second sentence.');
            expect(
                firstChip.compareDocumentPosition(secondSentence) & Node.DOCUMENT_POSITION_FOLLOWING
            ).toBeTruthy();
        });
    });

    describe('copy/polish batch (expert review WIN 7)', () => {
        it('shows the setup-oriented heading (not "ask me anything") while setup blocks the composer', () => {
            // Never-resolving readiness fetch keeps `setupReady` false.
            vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
            render(<ChatWindow turns={[]} onSend={noop} />);

            expect(screen.getByText('Set up the AI assistant to start asking')).toBeInTheDocument();
            expect(screen.queryByText(/Ask me anything/)).toBeNull();
        });

        it('interpolates the usage snapshot model into error copy when the turn carries none', () => {
            render(
                <ChatWindow
                    turns={[userTurn('u1'), errorTurn('a1', 'quota_exhausted')]}
                    onSend={noop}
                    usage={{ model: 'gemini-2.5-flash', requestsToday: 20, dailyLimit: 20, estQuestionsLeft: 0 }}
                />
            );

            expect(screen.getByText(/usage limit/i).textContent).toContain('gemini-2.5-flash');
        });

        it('falls back to a generic word when neither the turn nor the usage snapshot carries a model', () => {
            render(
                <ChatWindow turns={[userTurn('u1'), errorTurn('a1', 'quota_exhausted')]} onSend={noop} />
            );

            const message = screen.getByText(/usage limit/i);
            expect(message.textContent).toContain('the current model');
            expect(message.textContent).not.toMatch(/for\s*\./); // never an empty interpolation
        });

        it('Enter during an in-flight ask shows the asking hint instead of silently doing nothing', () => {
            const onSend = vi.fn();
            render(
                <ChatWindow turns={[userTurn('u1'), streamingTurn('a1')]} onSend={onSend} isAsking />
            );

            const textarea = screen.getByPlaceholderText('Ask a question...');
            fireEvent.change(textarea, { target: { value: 'next question' } });
            fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

            expect(onSend).not.toHaveBeenCalled();
            expect(screen.getByTestId('ai-asking-hint')).toBeInTheDocument();
        });

        it('assistant turns expose a hover timestamp via title', () => {
            const { container } = render(
                <ChatWindow turns={[userTurn('u1'), stoppedTurn('a1')]} onSend={noop} />
            );

            const expected = new Date(2000).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
            });
            expect(container.querySelector(`[title="${expected}"]`)).not.toBeNull();
        });

        it('the Stop button carries a tooltip', () => {
            render(<ChatWindow turns={[userTurn('u1'), streamingTurn('a1')]} onSend={noop} isAsking />);

            expect(screen.getByRole('button', { name: 'Stop' })).toHaveAttribute('title', 'Stop');
        });
    });
});
