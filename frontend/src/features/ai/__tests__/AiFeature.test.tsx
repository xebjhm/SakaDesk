// frontend/src/features/ai/__tests__/AiFeature.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AiFeature } from '../AiFeature';
import type { AskAnswer } from '../api';

// `ChatWindow`'s empty state now mounts `SetupChecklist`, which fetches
// `GET /api/ai/readiness` on mount (Product-wave Task 4, item 3) and keeps
// the chat input disabled until it reports fully configured -- stub a
// permanently-ready response so these ask-flow tests (which predate that
// gate) keep exercising the input the moment it renders, same as before.
function stubReadyFetch() {
    vi.stubGlobal(
        'fetch',
        vi.fn((input: string | URL | Request) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
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
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        })
    );
}

const { mockAskKnowledge } = vi.hoisted(() => ({ mockAskKnowledge: vi.fn() }));
vi.mock('../api', () => ({
    askKnowledge: mockAskKnowledge,
}));

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
});
