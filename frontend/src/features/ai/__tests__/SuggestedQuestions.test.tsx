// frontend/src/features/ai/__tests__/SuggestedQuestions.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SuggestedQuestions } from '../components/SuggestedQuestions';
import { ChatWindow } from '../components/ChatWindow';

describe('SuggestedQuestions', () => {
    it('renders one chip per taxonomy category', () => {
        render(<SuggestedQuestions onPick={() => {}} />);
        const container = screen.getByTestId('ai-suggested-questions');
        const chips = container.querySelectorAll('button');
        expect(chips.length).toBe(5);
        expect(screen.getByText('Try asking:')).toBeInTheDocument();
    });

    it('calls onPick with the question text when a chip is clicked', () => {
        const onPick = vi.fn();
        render(<SuggestedQuestions onPick={onPick} />);
        fireEvent.click(
            screen.getByText('How many messages did ○○ send last month?')
        );
        expect(onPick).toHaveBeenCalledWith(
            'How many messages did ○○ send last month?'
        );
    });
});

// ChatWindow integration -- chips live in the empty state, gated on setup
// readiness, and fill the composer instead of auto-sending (a template
// question with a ○○ placeholder must never burn cloud quota directly).
describe('ChatWindow suggested-question chips', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /** Stub fetch so `SetupChecklist` immediately reports ready and
     * `UsageMeter` renders nothing (same shape as AiFeature.test.tsx). */
    function stubReadyFetch() {
        vi.stubGlobal(
            'fetch',
            vi.fn((input: string | URL | Request) => {
                const url =
                    typeof input === 'string'
                        ? input
                        : input instanceof URL
                          ? input.toString()
                          : input.url;
                if (url === '/api/ai/readiness') {
                    return Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve({
                                enabled: true,
                                embeddingModel: { ok: true, model: 'granite' },
                                llm: { ok: true, backend: 'cloud', model: 'g' },
                                index: { documentCount: 1 },
                                // The ready gate (findings M5/M8) now also
                                // requires the ONNX runtime to be in place.
                                runtime: { ok: true, state: 'bundled', host: 'cpu-x64' },
                            }),
                    });
                }
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                });
            })
        );
    }

    it('shows chips once setup is ready and fills the composer on click', async () => {
        stubReadyFetch();
        render(
            <ChatWindow
                turns={[]}
                onSend={() => {}}
                onStop={() => {}}
            />
        );
        // Chips appear only after the readiness probe resolves.
        await waitFor(() =>
            expect(
                screen.getByTestId('ai-suggested-questions')
            ).toBeInTheDocument()
        );

        const question = 'How many messages did ○○ send last month?';
        fireEvent.click(screen.getByText(question));

        const composer = screen.getByPlaceholderText(
            'Ask a question...'
        ) as HTMLTextAreaElement;
        expect(composer.value).toBe(question);
        expect(composer).toHaveFocus();

        // WIN 7h: the ○○ member-name placeholder is SELECTED, so the user's
        // next keystroke replaces it instead of appending after it.
        const placeholderStart = question.indexOf('○○');
        expect(composer.selectionStart).toBe(placeholderStart);
        expect(composer.selectionEnd).toBe(placeholderStart + '○○'.length);
    });

    it('hides chips while setup is still blocking', () => {
        // Never-resolving readiness fetch keeps `setupReady` false.
        vi.stubGlobal(
            'fetch',
            vi.fn(() => new Promise(() => {}))
        );
        render(
            <ChatWindow
                turns={[]}
                onSend={() => {}}
                onStop={() => {}}
            />
        );
        expect(
            screen.queryByTestId('ai-suggested-questions')
        ).not.toBeInTheDocument();
    });
});
