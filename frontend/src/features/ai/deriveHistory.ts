// frontend/src/features/ai/deriveHistory.ts
// Product-wave Task 6, item 3: turns a service's rendered chat thread into
// `askKnowledge`'s `history` option. Extracted to its own module (rather
// than living inline in `AiFeature.tsx`) purely so that file stays
// component-only (`react-refresh/only-export-components`) and so this pure
// derivation logic can be unit-tested directly.

import type { AskHistoryMessage } from './api';
import type { ChatTurn } from './types';

// How many prior EXCHANGES (user+assistant pairs) to send as `history` --
// matches `backend/api/ai.py`'s `_MAX_HISTORY_MESSAGES` (12 messages == 6
// exchanges) so a well-behaved client never hits the server's
// reject-oversized cap.
export const MAX_HISTORY_EXCHANGES = 6;

/**
 * Derives `askKnowledge`'s `history` option from a service's rendered thread:
 * user turns verbatim, `answered` assistant turns collapsed to their
 * sentence text joined with a space -- explicitly NO citations/refs (those
 * are UI-only, meaningless to feed back as prior "answer" content).
 * `streaming`/`noEvidence`/`error`/`stopped` assistant turns are skipped
 * entirely -- there's nothing useful (or, for an error's raw message, safe)
 * to replay as a prior answer.
 *
 * `turns` should be the thread BEFORE the new question's own turns are
 * appended (i.e. what `AiFeature` already has in the store at submit time).
 */
export function deriveHistory(turns: ChatTurn[]): AskHistoryMessage[] {
    const messages: AskHistoryMessage[] = [];
    for (const turn of turns) {
        if (turn.role === 'user') {
            messages.push({ role: 'user', content: turn.text });
        } else if (turn.role === 'assistant' && turn.state === 'answered') {
            messages.push({
                role: 'assistant',
                content: turn.answer.sentences.map((s) => s.text).join(' '),
            });
        }
    }
    return messages.slice(-MAX_HISTORY_EXCHANGES * 2);
}
