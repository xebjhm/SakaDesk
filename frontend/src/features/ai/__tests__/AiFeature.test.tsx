// frontend/src/features/ai/__tests__/AiFeature.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AiFeature } from '../AiFeature';
import { AskError } from '../api';
import type { AskAnswer } from '../api';
import { useAppStore } from '../../../store/appStore';

interface FetchStubOverrides {
    /** `GET /api/ai/config`'s response -- defaults to an empty object (no
     * `backend` field), which keeps `AiFeature`'s cloud-consent gate a no-op
     * for every pre-existing test below (`backendKind` stays `null`). */
    config?: Record<string, unknown>;
    /** `GET /api/ai/consent`'s response. */
    consent?: Record<string, unknown>;
    /** `GET /api/ai/usage`'s response. */
    usage?: Record<string, unknown>;
    onConsentPost?: () => void;
    /** When set, `POST /api/ai/consent`'s response doesn't resolve until this
     * promise settles -- lets a test hold the request "in flight" to exercise
     * the accept button's double-submit guard. */
    consentPostGate?: Promise<void>;
}

// `ChatWindow`'s empty state now mounts `SetupChecklist`, which fetches
// `GET /api/ai/readiness` on mount (Product-wave Task 4, item 3) and keeps
// the chat input disabled until it reports fully configured -- stub a
// permanently-ready response so these ask-flow tests (which predate that
// gate) keep exercising the input the moment it renders, same as before.
function stubReadyFetch(overrides: FetchStubOverrides = {}) {
    vi.stubGlobal(
        'fetch',
        vi.fn((input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            const method = (init?.method ?? 'GET').toUpperCase();
            if (url === '/api/ai/readiness') {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            enabled: true,
                            embeddingModel: { ok: true, model: 'granite-embedding-278m-multilingual' },
                            llm: { ok: true, backend: 'cloud', model: 'gemini-2.5-flash' },
                            index: { documentCount: 1 },
                        }),
                });
            }
            if (url === '/api/ai/config' && method === 'GET') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides.config ?? {}) });
            }
            if (url === '/api/ai/consent' && method === 'GET') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(overrides.consent ?? { granted: false, consentedAt: null }),
                });
            }
            if (url === '/api/ai/consent' && method === 'POST') {
                overrides.onConsentPost?.();
                const respond = () =>
                    Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ ok: true, consentedAt: '2026-07-01T00:00:00+00:00' }),
                    });
                return overrides.consentPostGate ? overrides.consentPostGate.then(respond) : respond();
            }
            if (url === '/api/ai/usage') {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve(
                            overrides.usage ?? { model: 'x', requestsToday: 0, dailyLimit: null, estQuestionsLeft: null }
                        ),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        })
    );
}

const { mockAskKnowledge } = vi.hoisted(() => ({ mockAskKnowledge: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    // Keep the REAL `providerNameFromBaseUrl`/`canonicalMemberId` (pure helpers
    // `AiFeature` also imports from this module) — only `askKnowledge` (the
    // SSE network call) is mocked.
    const actual = await importOriginal<typeof import('../api')>();
    return { ...actual, askKnowledge: mockAskKnowledge };
});

const { mockNavigateToSource } = vi.hoisted(() => ({ mockNavigateToSource: vi.fn() }));
vi.mock('../../../utils/navigateToSource', () => ({
    navigateToSource: mockNavigateToSource,
}));

// The REAL zustand store (Product-wave Task 6) — `AiFeature` now reads/writes
// `aiThreadsByService`/`aiIsAsking`/`aiAbortControllers` through it directly,
// so a hand-rolled selector-only mock (the old approach) can no longer stand
// in for it. `resetAiStore` below re-seeds just the fields these tests touch
// before each test, mirroring `store/appStore.test.ts`'s own convention of
// resetting via `useAppStore.setState(...)` rather than mocking the module.
function resetAiStore(activeService: string | null = 'hinatazaka46') {
    useAppStore.setState({
        activeService,
        aiThreadsByService: {},
        aiIsAsking: {},
        aiAbortControllers: {},
    });
}

const ANSWERED: AskAnswer = {
    sentences: [{ text: '焼肉を食べました。', citationIds: ['msg:hinatazaka46:42'] }],
    citations: [
        {
            docId: 'msg:hinatazaka46:42',
            ref: {
                type: 'message',
                service: 'hinatazaka46',
                groupId: 1,
                groupName: 'group-name',
                memberId: 2,
                memberName: 'member-name',
                messageId: 42,
                isGroupChat: true,
            },
            snippet: '焼肉を食べました。',
            member: 'member-name',
            timestamp: '2026-06-30T12:00:00+00:00',
        },
    ],
    noEvidence: false,
};

async function askQuestion(question: string) {
    // `findByPlaceholderText` (not `getBy...`) so this waits out the async
    // `SetupChecklist` readiness fetch that gates the input on first mount.
    const input = await screen.findByPlaceholderText('Ask a question...');
    await userEvent.type(input, question);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('AiFeature', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        stubReadyFetch();
        resetAiStore();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renders the answer with an inline citation chip, and clicking the chip navigates to the source', async () => {
        mockAskKnowledge.mockImplementation((_service, _question, _tz, onProgress: (label: string) => void) => {
            onProgress('thinking');
            return Promise.resolve(ANSWERED);
        });

        render(<AiFeature />);
        await askQuestion('何を食べた?');

        expect(mockAskKnowledge).toHaveBeenCalledWith(
            'hinatazaka46',
            '何を食べた?',
            expect.any(String),
            expect.any(Function),
            expect.objectContaining({ signal: expect.anything(), history: [] })
        );

        expect(await screen.findByText('焼肉を食べました。')).toBeInTheDocument();

        const chip = screen.getByRole('button', { name: /Source: member-name/ });
        expect(chip).toBeInTheDocument();

        await userEvent.click(chip);
        expect(mockNavigateToSource).toHaveBeenCalledWith(ANSWERED.citations[0].ref);
    });

    it('renders a distinct, non-error "no evidence" state', async () => {
        mockAskKnowledge.mockResolvedValue({ sentences: [], citations: [], noEvidence: true } as AskAnswer);

        const { container } = render(<AiFeature />);
        await askQuestion('unanswerable question');

        expect(
            await screen.findByText("I couldn't find anything in your synced content to answer that.")
        ).toBeInTheDocument();
        // Distinct from the error styling below — no red error box rendered.
        expect(container.querySelector('.text-red-700')).toBeNull();
    });

    it('renders a visible, localized error state (not a crash, not raw English) when askKnowledge rejects with no code', async () => {
        // A legacy/uncoded rejection (e.g. a bare network Error) must still render
        // a friendly, localized message — never the raw exception text on the wire.
        mockAskKnowledge.mockRejectedValue(new Error('some internal detail leaked here'));

        render(<AiFeature />);
        await askQuestion('will this fail?');

        expect(
            await screen.findByText('Something went wrong answering that. Please try again.')
        ).toBeInTheDocument();
        expect(screen.queryByText('some internal detail leaked here')).toBeNull();
    });

    it('renders the quota_exhausted copy (not the generic fallback) for a coded AskError, with the model interpolated', async () => {
        const quotaError = Object.assign(new Error('raw provider quota message'), {
            code: 'quota_exhausted',
            model: 'gemini-2.5-flash',
            backend: 'cloud',
        });
        mockAskKnowledge.mockRejectedValue(quotaError);

        render(<AiFeature />);
        await askQuestion('will this hit quota?');

        const message = await screen.findByText(/usage limit/i);
        expect(message.textContent).toContain('gemini-2.5-flash');
        // Never the generic fallback, and never the raw provider text.
        expect(
            screen.queryByText('Something went wrong answering that. Please try again.')
        ).toBeNull();
        expect(screen.queryByText('raw provider quota message')).toBeNull();
        // Quota is one of the codes that gets the "open AI settings" ACTION
        // (a real button since expert review WIN 2, not inert hint text).
        expect(screen.getByRole('button', { name: 'Open AI settings' })).toBeInTheDocument();
    });

    it('a quota error renders exactly one guidance line + one action (WIN 4): no retry-after or quota-left stack', async () => {
        const quotaError = Object.assign(new Error('quota'), {
            code: 'quota_exhausted',
            model: 'gemini-2.5-flash',
            retryAfterS: 42,
            estQuestionsLeft: 0,
        });
        mockAskKnowledge.mockRejectedValue(quotaError);

        render(<AiFeature />);
        await askQuestion('will this hit quota?');

        await screen.findByText(/usage limit/i);
        expect(screen.queryByText('You can try again in 42s.')).toBeNull();
        expect(
            screen.queryByText('No questions left today — try again tomorrow, or switch to a local model.')
        ).toBeNull();
        expect(screen.getByRole('button', { name: 'Open AI settings' })).toBeInTheDocument();
    });

    it('shows a retry-after hint when a non-quota error carries retryAfterS', async () => {
        const timeoutError = Object.assign(new Error('busy'), {
            code: 'timeout',
            retryAfterS: 42,
        });
        mockAskKnowledge.mockRejectedValue(timeoutError);

        render(<AiFeature />);
        await askQuestion('will this time out?');

        expect(await screen.findByText('You can try again in 42s.')).toBeInTheDocument();
    });

    it('renders the kb_disabled copy (not the generic fallback) with the open-settings hint', async () => {
        // Task 3 item 1: `/ask` streams `event: error {code: "kb_disabled"}` when
        // `knowledge_base.enabled` is false -- must map to a friendly, localized
        // "enable it in settings" message, not the generic fallback.
        const kbDisabledError = Object.assign(new Error('raw internal detail'), {
            code: 'kb_disabled',
        });
        mockAskKnowledge.mockRejectedValue(kbDisabledError);

        render(<AiFeature />);
        await askQuestion('will this be disabled?');

        expect(
            await screen.findByText('The knowledge chatbot is turned off. Enable it in AI settings.')
        ).toBeInTheDocument();
        expect(
            screen.queryByText('Something went wrong answering that. Please try again.')
        ).toBeNull();
        // kb_disabled's fix lives in AI settings too, so it gets the same action.
        expect(screen.getByRole('button', { name: 'Open AI settings' })).toBeInTheDocument();
    });

    it('renders the unreachable copy without an "open settings" action (not one of the settings-fixable codes)', async () => {
        const unreachableError = Object.assign(new Error('connect failed'), {
            code: 'unreachable',
        });
        mockAskKnowledge.mockRejectedValue(unreachableError);

        render(<AiFeature />);
        await askQuestion('will this be unreachable?');

        expect(await screen.findByText(/ollama/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Open AI settings' })).toBeNull();
    });

    describe('cloud-privacy consent gate (Product-wave Task 5, item 5)', () => {
        const CLOUD_CONFIG = {
            backend: 'cloud',
            base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
            model: 'gemini-2.5-flash',
        };
        const NOT_CONSENTED = { granted: false, consentedAt: null };

        it('shows the consent modal before the first cloud ask, without calling askKnowledge', async () => {
            stubReadyFetch({ config: CLOUD_CONFIG, consent: NOT_CONSENTED });

            render(<AiFeature />);
            await askQuestion('will this ask the cloud?');

            expect(await screen.findByText('Before this question leaves your device')).toBeInTheDocument();
            expect(screen.getByText(/Google/)).toBeInTheDocument();
            expect(mockAskKnowledge).not.toHaveBeenCalled();
        });

        it('declining the modal never sends the question', async () => {
            stubReadyFetch({ config: CLOUD_CONFIG, consent: NOT_CONSENTED });

            render(<AiFeature />);
            await askQuestion('will this ask the cloud?');
            await screen.findByText('Before this question leaves your device');

            await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

            expect(mockAskKnowledge).not.toHaveBeenCalled();
            expect(screen.queryByText('Before this question leaves your device')).not.toBeInTheDocument();
        });

        it('accepting the modal POSTs /api/ai/consent and sends the pending question', async () => {
            mockAskKnowledge.mockResolvedValue({ sentences: [], citations: [], noEvidence: true } as AskAnswer);
            const onConsentPost = vi.fn();
            stubReadyFetch({ config: CLOUD_CONFIG, consent: NOT_CONSENTED, onConsentPost });

            render(<AiFeature />);
            await askQuestion('will this ask the cloud?');
            await screen.findByText('Before this question leaves your device');

            await userEvent.click(screen.getByRole('button', { name: 'I understand, continue' }));

            await waitFor(() => expect(onConsentPost).toHaveBeenCalled());
            await waitFor(() =>
                expect(mockAskKnowledge).toHaveBeenCalledWith(
                    'hinatazaka46',
                    'will this ask the cloud?',
                    expect.any(String),
                    expect.any(Function),
                    expect.objectContaining({ signal: expect.anything(), history: [] })
                )
            );
            expect(screen.queryByText('Before this question leaves your device')).not.toBeInTheDocument();
        });

        it('a slow /api/ai/consent POST still only fires once, even racing a second submit attempt', async () => {
            // `AiFeature` itself already closes the modal synchronously on the
            // FIRST click (see `handleConsentAccept`); this proves that path
            // stays a single POST even when the request is slow -- the
            // button's own double-submit guard is unit-tested directly in
            // `CloudConsentModal.test.tsx` (this component unmounting on
            // click means a real second click on the same node isn't
            // reachable from here).
            mockAskKnowledge.mockResolvedValue({ sentences: [], citations: [], noEvidence: true } as AskAnswer);
            let releaseConsentPost: () => void = () => {};
            const consentPostGate = new Promise<void>((resolve) => {
                releaseConsentPost = resolve;
            });
            const onConsentPost = vi.fn();
            stubReadyFetch({ config: CLOUD_CONFIG, consent: NOT_CONSENTED, onConsentPost, consentPostGate });

            render(<AiFeature />);
            await askQuestion('will this ask the cloud?');
            await screen.findByText('Before this question leaves your device');

            await userEvent.click(screen.getByRole('button', { name: 'I understand, continue' }));
            expect(screen.queryByText('Before this question leaves your device')).not.toBeInTheDocument();

            releaseConsentPost();
            await waitFor(() => expect(mockAskKnowledge).toHaveBeenCalled());
            expect(onConsentPost).toHaveBeenCalledTimes(1);
        });

        it('the local backend never shows the consent modal', async () => {
            mockAskKnowledge.mockResolvedValue({ sentences: [], citations: [], noEvidence: true } as AskAnswer);
            stubReadyFetch({
                config: { backend: 'local', base_url: 'http://localhost:11434/v1', model: 'qwen3:30b' },
                consent: NOT_CONSENTED,
            });

            render(<AiFeature />);
            await askQuestion('local question');

            expect(mockAskKnowledge).toHaveBeenCalled();
            expect(screen.queryByText('Before this question leaves your device')).not.toBeInTheDocument();
        });

        it('an already-granted consent never shows the modal', async () => {
            mockAskKnowledge.mockResolvedValue({ sentences: [], citations: [], noEvidence: true } as AskAnswer);
            stubReadyFetch({
                config: CLOUD_CONFIG,
                consent: { granted: true, consentedAt: '2026-06-01T00:00:00+00:00' },
            });

            render(<AiFeature />);
            await askQuestion('already consented');

            expect(mockAskKnowledge).toHaveBeenCalled();
            expect(screen.queryByText('Before this question leaves your device')).not.toBeInTheDocument();
        });
    });

    describe('usage meter + backend badge (Product-wave Task 5, items 3 + 5)', () => {
        it('renders the composer usage meter with the remaining question estimate', async () => {
            stubReadyFetch({
                usage: { model: 'gemini-2.5-flash', requestsToday: 4, dailyLimit: 20, estQuestionsLeft: 4 },
            });

            render(<AiFeature />);
            await screen.findByPlaceholderText('Ask a question...');

            expect(await screen.findByText('~4 questions left today')).toBeInTheDocument();
        });

        it('renders no meter at all when the backend is unlimited', async () => {
            stubReadyFetch({
                usage: { model: 'qwen3:30b', requestsToday: 10, dailyLimit: null, estQuestionsLeft: null },
            });

            render(<AiFeature />);
            await screen.findByPlaceholderText('Ask a question...');

            expect(screen.queryByTestId('usage-meter')).not.toBeInTheDocument();
        });

        it('renders the slim Cloud badge (privacy phrase in the tooltip) when the configured backend is cloud', async () => {
            stubReadyFetch({
                config: {
                    backend: 'cloud',
                    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
                    model: 'gemini-2.5-flash',
                },
            });

            render(<AiFeature />);
            await screen.findByPlaceholderText('Ask a question...');

            const badge = await screen.findByTestId('ai-backend-badge');
            expect(badge).toHaveTextContent('Cloud');
            // WIN 7f: the privacy phrase moved out of the badge text into a
            // title tooltip.
            expect(badge).toHaveAttribute('title', expect.stringMatching(/leave this device/i));
        });

        it('renders the slim Local badge when the configured backend is local', async () => {
            stubReadyFetch({
                config: { backend: 'local', base_url: 'http://localhost:11434/v1', model: 'qwen3:30b' },
            });

            render(<AiFeature />);
            await screen.findByPlaceholderText('Ask a question...');

            const badge = await screen.findByTestId('ai-backend-badge');
            expect(badge).toHaveTextContent('Local');
            expect(badge).toHaveAttribute('title', expect.stringMatching(/stays on this device/i));
        });
    });

    describe('quota pre-empt (P-5 review, item 2)', () => {
        const CLOUD_CONFIG = {
            backend: 'cloud',
            base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
            model: 'gemini-2.5-flash',
        };
        const GRANTED = { granted: true, consentedAt: '2026-06-01T00:00:00+00:00' };

        it('pre-empts the ask when estQuestionsLeft is 0 on the cloud backend: renders the quota turn, never calls askKnowledge', async () => {
            stubReadyFetch({
                config: CLOUD_CONFIG,
                consent: GRANTED,
                usage: { model: 'gemini-2.5-flash', requestsToday: 20, dailyLimit: 20, estQuestionsLeft: 0 },
            });

            render(<AiFeature />);
            // Wait for the usage fetch to settle before submitting -- otherwise
            // the click could race the still-in-flight `GET /api/ai/usage`.
            await screen.findByText('No questions left today — try again tomorrow, or switch to a local model.');

            await askQuestion('any questions left today?');

            expect(mockAskKnowledge).not.toHaveBeenCalled();
            // Reuses the existing quota_exhausted copy (with the model interpolated)...
            const message = await screen.findByText(/usage limit/i);
            expect(message.textContent).toContain('gemini-2.5-flash');
            // ...as the ONE guidance line (WIN 4): the old duplicate
            // `ai.quota.none` line is gone from BOTH the bubble and the
            // composer's `UsageMeter` (hidden while the newest turn is a
            // quota error)...
            expect(
                screen.queryByText('No questions left today — try again tomorrow, or switch to a local model.')
            ).toBeNull();
            expect(screen.queryByTestId('usage-meter')).not.toBeInTheDocument();
            // ...plus the one "open AI settings" action button.
            expect(screen.getByRole('button', { name: 'Open AI settings' })).toBeInTheDocument();
            // The composer stays enabled -- the user can still switch backends and retry.
            expect(screen.getByPlaceholderText('Ask a question...')).not.toBeDisabled();
        });

        it('proceeds with the ask normally when estQuestionsLeft is above zero on the cloud backend', async () => {
            mockAskKnowledge.mockResolvedValue({ sentences: [], citations: [], noEvidence: true } as AskAnswer);
            stubReadyFetch({
                config: CLOUD_CONFIG,
                consent: GRANTED,
                usage: { model: 'gemini-2.5-flash', requestsToday: 5, dailyLimit: 20, estQuestionsLeft: 15 },
            });

            render(<AiFeature />);
            await screen.findByText('~15 questions left today');

            await askQuestion('still have quota?');

            expect(mockAskKnowledge).toHaveBeenCalledWith(
                'hinatazaka46',
                'still have quota?',
                expect.any(String),
                expect.any(Function),
                expect.objectContaining({ signal: expect.anything(), history: [] })
            );
        });

        it('the local backend never pre-empts, even if the cached usage happens to read zero', async () => {
            mockAskKnowledge.mockResolvedValue({ sentences: [], citations: [], noEvidence: true } as AskAnswer);
            stubReadyFetch({
                config: { backend: 'local', base_url: 'http://localhost:11434/v1', model: 'qwen3:30b' },
                usage: { model: 'qwen3:30b', requestsToday: 20, dailyLimit: 20, estQuestionsLeft: 0 },
            });

            render(<AiFeature />);
            await screen.findByText('No questions left today — try again tomorrow, or switch to a local model.');

            await askQuestion('local question with a stale zero usage number');

            expect(mockAskKnowledge).toHaveBeenCalled();
        });
    });

    describe('durable thread (Product-wave Task 6, item 1)', () => {
        it('the thread survives AiFeature unmounting and remounting', async () => {
            mockAskKnowledge.mockResolvedValue(ANSWERED);

            const { unmount } = render(<AiFeature />);
            await askQuestion('何を食べた?');
            expect(await screen.findByText('焼肉を食べました。')).toBeInTheDocument();

            unmount();
            render(<AiFeature />);

            expect(await screen.findByText('焼肉を食べました。')).toBeInTheDocument();
            // Remounting must not re-fire the ask.
            expect(mockAskKnowledge).toHaveBeenCalledTimes(1);
        });

        it('an answer resolving while AiFeature is unmounted still lands in the thread on remount', async () => {
            let resolveAsk: (value: AskAnswer) => void = () => {};
            mockAskKnowledge.mockImplementation(
                (_service, _question, _tz, onProgress: (label: string) => void) => {
                    onProgress('thinking');
                    return new Promise<AskAnswer>((resolve) => {
                        resolveAsk = resolve;
                    });
                }
            );

            const { unmount } = render(<AiFeature />);
            await askQuestion('何を食べた?');
            await screen.findByText('Thinking…');

            // The component tree is gone BEFORE the ask settles -- the
            // original bug (local `useState` in `AiFeature`) discarded this
            // update entirely once the owning component instance was torn
            // down. The store-backed version must not.
            unmount();
            resolveAsk(ANSWERED);
            await waitFor(() => {
                const thread = useAppStore.getState().getAiThread('hinatazaka46');
                expect(thread.some((t) => t.role === 'assistant' && t.state === 'answered')).toBe(
                    true
                );
            });

            render(<AiFeature />);
            expect(await screen.findByText('焼肉を食べました。')).toBeInTheDocument();
        });

        it('the thread survives a citation-navigation-style feature switch (the real mechanism navigateToSource uses)', async () => {
            mockAskKnowledge.mockResolvedValue(ANSWERED);

            const { unmount } = render(<AiFeature />);
            await askQuestion('何を食べた?');
            expect(await screen.findByText('焼肉を食べました。')).toBeInTheDocument();

            // `navigateToSource` (mocked to a spy elsewhere in this file) is
            // itself just a `setActiveFeature` call under the hood -- which
            // is what actually unmounts `AiFeature` in the running app
            // (`ContentArea` switches on `activeFeature`). Exercise that
            // same store call directly, on the REAL store, then simulate the
            // resulting unmount/remount.
            unmount();
            useAppStore.getState().setActiveFeature('hinatazaka46', 'blogs');
            useAppStore.getState().setActiveFeature('hinatazaka46', 'ai');

            render(<AiFeature />);
            expect(await screen.findByText('焼肉を食べました。')).toBeInTheDocument();
        });
    });

    describe('clear thread (Product-wave Task 6, item 1)', () => {
        it('clears only the active service thread, leaving other services untouched', async () => {
            mockAskKnowledge.mockResolvedValue(ANSWERED);
            useAppStore
                .getState()
                .appendAiTurns('sakurazaka46', [
                    { id: 'other-1', role: 'user', text: 'other service question', createdAt: 1 },
                ]);

            render(<AiFeature />);
            await askQuestion('何を食べた?');
            expect(await screen.findByText('焼肉を食べました。')).toBeInTheDocument();

            // Inline two-step confirm (expert review WIN 5): the first click
            // only ARMS the button; the thread is untouched until the second.
            await userEvent.click(screen.getByRole('button', { name: 'Clear conversation' }));
            expect(screen.getByText('焼肉を食べました。')).toBeInTheDocument();
            await userEvent.click(screen.getByRole('button', { name: 'Sure?' }));

            expect(screen.queryByText('焼肉を食べました。')).not.toBeInTheDocument();
            expect(useAppStore.getState().getAiThread('hinatazaka46')).toEqual([]);
            expect(useAppStore.getState().getAiThread('sakurazaka46')).toHaveLength(1);
        });
    });

    describe('stop (Product-wave Task 6, item 2)', () => {
        it('aborting mid-stream renders a "stopped" turn (not an error), re-enables Send, and a second ask still works', async () => {
            mockAskKnowledge.mockImplementation(
                (
                    _service,
                    _question,
                    _tz,
                    onProgress: (label: string) => void,
                    opts?: { signal?: AbortSignal }
                ) => {
                    onProgress('thinking');
                    return new Promise<AskAnswer>((_resolve, reject) => {
                        opts?.signal?.addEventListener('abort', () => {
                            reject(new AskError('aborted', 'The request was stopped.'));
                        });
                    });
                }
            );

            render(<AiFeature />);
            await askQuestion('will this be stopped?');

            const stopButton = await screen.findByRole('button', { name: 'Stop' });
            await userEvent.click(stopButton);

            expect(await screen.findByText('You stopped this answer.')).toBeInTheDocument();
            // Non-error styling: no red error box for the stopped turn.
            expect(document.querySelector('.text-red-700')).toBeNull();
            expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();

            // A second ask afterwards must still work normally (the lock/
            // abort-controller bookkeeping doesn't wedge the next ask).
            mockAskKnowledge.mockResolvedValue({
                sentences: [],
                citations: [],
                noEvidence: true,
            } as AskAnswer);
            await askQuestion('does it still work?');
            expect(
                await screen.findByText(
                    "I couldn't find anything in your synced content to answer that."
                )
            ).toBeInTheDocument();
        });
    });

    describe('heartbeat de-dup (expert review WIN 1a)', () => {
        it('progress events with an unchanged label never touch the store (no new turn objects)', async () => {
            let sendProgress: (label: string) => void = () => {};
            mockAskKnowledge.mockImplementation(
                (_service, _question, _tz, onProgress: (label: string) => void) => {
                    sendProgress = onProgress;
                    return new Promise<AskAnswer>(() => {
                        // Never resolves -- this test only exercises the
                        // in-flight heartbeat path.
                    });
                }
            );

            render(<AiFeature />);
            await askQuestion('slow question');
            await screen.findByText('Thinking…');

            // The backend heartbeats `{stage: "thinking"}` every ~1s for the
            // whole 20-60s ask. Same resolved label -> the store bundle must
            // be IDENTICAL (===) afterwards, or every heartbeat re-renders
            // the thread (and used to re-trigger auto-scroll, WIN 1).
            const before = useAppStore.getState().aiThreadsByService;
            act(() => {
                sendProgress('thinking');
                sendProgress('thinking');
                sendProgress('thinking');
            });
            expect(useAppStore.getState().aiThreadsByService).toBe(before);

            // A REAL stage change still lands in the turn.
            act(() => {
                sendProgress('indexing');
            });
            expect(await screen.findByText('Indexing your data…')).toBeInTheDocument();
            expect(useAppStore.getState().aiThreadsByService).not.toBe(before);
        });
    });

    describe('composer (Product-wave Task 6, item 4)', () => {
        it('the text input stays enabled and typeable while an ask is in flight; only Send/Stop swaps', async () => {
            mockAskKnowledge.mockImplementation(
                (_service, _question, _tz, onProgress: (label: string) => void) => {
                    onProgress('thinking');
                    return new Promise<AskAnswer>(() => {
                        // Never resolves -- this test only cares about the
                        // in-flight state.
                    });
                }
            );

            render(<AiFeature />);
            await askQuestion('slow question');

            const textarea = await screen.findByPlaceholderText('Ask a question...');
            expect(textarea).not.toBeDisabled();
            expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();

            // The user can keep typing their NEXT question while this one streams.
            await userEvent.type(textarea, 'next question');
            expect(textarea).toHaveValue('next question');
        });

        it('Enter submits the question; Shift+Enter does not', async () => {
            mockAskKnowledge.mockResolvedValue({
                sentences: [],
                citations: [],
                noEvidence: true,
            } as AskAnswer);

            render(<AiFeature />);
            const textarea = await screen.findByPlaceholderText('Ask a question...');
            await userEvent.type(textarea, 'a question');

            fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true, code: 'Enter' });
            expect(mockAskKnowledge).not.toHaveBeenCalled();

            fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false, code: 'Enter' });
            await waitFor(() => expect(mockAskKnowledge).toHaveBeenCalledTimes(1));
        });
    });
});
