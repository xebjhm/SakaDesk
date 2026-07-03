// frontend/src/features/ai/__tests__/AiFeature.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AiFeature } from '../AiFeature';
import type { AskAnswer } from '../api';

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
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ ok: true, consentedAt: '2026-07-01T00:00:00+00:00' }),
                });
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

// Selector-aware mock — AiFeature calls `useAppStore((state) => state.activeService)`.
vi.mock('../../../store/appStore', () => ({
    useAppStore: (selector: (state: { activeService: string | null }) => unknown) =>
        selector({ activeService: 'hinatazaka46' }),
}));

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
            expect.any(Function)
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
        // Quota is one of the codes that gets the "open AI settings" hint.
        expect(screen.getByText('Open AI settings to fix this.')).toBeInTheDocument();
    });

    it('shows a retry-after hint when the error carries retryAfterS', async () => {
        const quotaError = Object.assign(new Error('quota'), {
            code: 'quota_exhausted',
            model: 'gemini-2.5-flash',
            retryAfterS: 42,
        });
        mockAskKnowledge.mockRejectedValue(quotaError);

        render(<AiFeature />);
        await askQuestion('will this hit quota?');

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
        // kb_disabled's fix lives in AI settings too, so it gets the same hint.
        expect(screen.getByText('Open AI settings to fix this.')).toBeInTheDocument();
    });

    it('renders the unreachable copy without an "open settings" hint (not one of the settings-fixable codes)', async () => {
        const unreachableError = Object.assign(new Error('connect failed'), {
            code: 'unreachable',
        });
        mockAskKnowledge.mockRejectedValue(unreachableError);

        render(<AiFeature />);
        await askQuestion('will this be unreachable?');

        expect(await screen.findByText(/ollama/i)).toBeInTheDocument();
        expect(screen.queryByText('Open AI settings to fix this.')).toBeNull();
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
                    expect.any(Function)
                )
            );
            expect(screen.queryByText('Before this question leaves your device')).not.toBeInTheDocument();
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

        it('renders the Cloud badge when the configured backend is cloud', async () => {
            stubReadyFetch({
                config: {
                    backend: 'cloud',
                    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
                    model: 'gemini-2.5-flash',
                },
            });

            render(<AiFeature />);
            await screen.findByPlaceholderText('Ask a question...');

            expect(await screen.findByText('Cloud — data leaves this device')).toBeInTheDocument();
        });

        it('renders the Local badge when the configured backend is local', async () => {
            stubReadyFetch({
                config: { backend: 'local', base_url: 'http://localhost:11434/v1', model: 'qwen3:30b' },
            });

            render(<AiFeature />);
            await screen.findByPlaceholderText('Ask a question...');

            expect(await screen.findByText('Local — on-device')).toBeInTheDocument();
        });
    });
});
