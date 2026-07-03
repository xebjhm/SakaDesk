// frontend/src/features/ai/__tests__/deriveHistory.test.ts
import { describe, it, expect } from 'vitest';
import { deriveHistory, MAX_HISTORY_EXCHANGES } from '../deriveHistory';
import type { ChatTurn } from '../types';
import type { AskAnswer } from '../api';

function userTurn(id: string, text: string): ChatTurn {
    return { id, role: 'user', text, createdAt: 1 };
}

function answeredTurn(id: string, sentences: string[]): ChatTurn {
    const answer: AskAnswer = {
        sentences: sentences.map((text) => ({ text, citationIds: ['doc-1'] })),
        citations: [
            {
                docId: 'doc-1',
                ref: { type: 'blog', service: 'hinatazaka46', blogId: '1', memberId: 1 },
                snippet: 'snippet',
                member: 'member',
                timestamp: '2026-06-01T00:00:00+00:00',
            },
        ],
        noEvidence: false,
    };
    return { id, role: 'assistant', state: 'answered', answer, createdAt: 1 };
}

describe('deriveHistory', () => {
    it('returns an empty array for an empty thread', () => {
        expect(deriveHistory([])).toEqual([]);
    });

    it('maps a user turn verbatim and an answered turn to its joined sentence text', () => {
        const turns: ChatTurn[] = [
            userTurn('u1', '焼肉好き?'),
            answeredTurn('a1', ['はい、焼肉が好きです。']),
        ];

        expect(deriveHistory(turns)).toEqual([
            { role: 'user', content: '焼肉好き?' },
            { role: 'assistant', content: 'はい、焼肉が好きです。' },
        ]);
    });

    it('joins multiple answer sentences with a space and drops citations/refs', () => {
        const turns: ChatTurn[] = [answeredTurn('a1', ['文1。', '文2。'])];

        expect(deriveHistory(turns)).toEqual([{ role: 'assistant', content: '文1。 文2。' }]);
    });

    it('skips streaming, noEvidence, error, and stopped assistant turns', () => {
        const turns: ChatTurn[] = [
            userTurn('u1', 'q1'),
            { id: 's1', role: 'assistant', state: 'streaming', progressLabel: 'Thinking…', createdAt: 1 },
            { id: 'n1', role: 'assistant', state: 'noEvidence', createdAt: 1 },
            {
                id: 'e1',
                role: 'assistant',
                state: 'error',
                code: 'unknown',
                message: 'internal detail',
                createdAt: 1,
            },
            { id: 'x1', role: 'assistant', state: 'stopped', createdAt: 1 },
        ];

        expect(deriveHistory(turns)).toEqual([{ role: 'user', content: 'q1' }]);
    });

    it('caps at the last MAX_HISTORY_EXCHANGES exchanges (2 messages each)', () => {
        const turns: ChatTurn[] = [];
        for (let i = 0; i < MAX_HISTORY_EXCHANGES + 3; i += 1) {
            turns.push(userTurn(`u${i}`, `question ${i}`));
            turns.push(answeredTurn(`a${i}`, [`answer ${i}`]));
        }

        const history = deriveHistory(turns);

        expect(history).toHaveLength(MAX_HISTORY_EXCHANGES * 2);
        // Keeps the MOST RECENT exchanges, not the oldest.
        expect(history[0]).toEqual({ role: 'user', content: 'question 3' });
        expect(history[history.length - 1]).toEqual({
            role: 'assistant',
            content: `answer ${MAX_HISTORY_EXCHANGES + 2}`,
        });
    });
});
