// frontend/src/features/ai/__tests__/AiFeature.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AiFeature } from '../AiFeature';
import type { AskAnswer } from '../api';

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
    const input = screen.getByPlaceholderText('Ask a question...');
    await userEvent.type(input, question);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('AiFeature', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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

    it('renders a visible error state (not a crash) when askKnowledge rejects', async () => {
        mockAskKnowledge.mockRejectedValue(new Error('The request failed unexpectedly.'));

        render(<AiFeature />);
        await askQuestion('will this fail?');

        expect(await screen.findByText('The request failed unexpectedly.')).toBeInTheDocument();
    });
});
