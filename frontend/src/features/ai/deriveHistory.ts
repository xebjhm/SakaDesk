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
 * Final review (minors): skipping those non-`answered` assistant turns can
 * leave two `user` turns (or, symmetrically, two `answered` assistant turns)
 * adjacent in the OUTPUT even though they weren't adjacent in `turns` -- e.g.
 * a question, a stopped/error reply, then a follow-up question. Some LLM
 * providers require strict user/assistant alternation in a chat history and
 * would reject (or silently misbehave on) two consecutive same-role turns,
 * so `collapseConsecutiveSameRole` merges any such run into one message
 * before the cap is applied.
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
    return collapseConsecutiveSameRole(messages).slice(-MAX_HISTORY_EXCHANGES * 2);
}

/**
 * Merges any run of consecutive same-role messages into a single message
 * (content joined with a space, in order) -- see `deriveHistory`'s docstring
 * for why. A no-op when `messages` already strictly alternates roles, which
 * is the common case (skipped turns are what create a run in the first
 * place).
 */
function collapseConsecutiveSameRole(messages: AskHistoryMessage[]): AskHistoryMessage[] {
    const collapsed: AskHistoryMessage[] = [];
    for (const message of messages) {
        const last = collapsed[collapsed.length - 1];
        if (last && last.role === message.role) {
            last.content = `${last.content} ${message.content}`.trim();
        } else {
            collapsed.push({ ...message });
        }
    }
    return collapsed;
}
