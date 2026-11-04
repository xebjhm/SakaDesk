import type { Message } from '../../../types';

// ASCII %%% (U+0025) and fullwidth ％％％ (U+FF05) stand for the user's nickname.
const HAS_PLACEHOLDER = /%%%|％％％/;
const PLACEHOLDERS = /%%%|％％％/g;

/**
 * Replace the nickname placeholder in message text. Returns the same array when nothing
 * changes, so memoised consumers (the timeline) keep their identity.
 */
export function applyNickname(messages: Message[], nickname: string | undefined): Message[] {
    if (!nickname) return messages;
    let changed = false;
    const out = messages.map((msg) => {
        if (!msg.content || !HAS_PLACEHOLDER.test(msg.content)) return msg;
        changed = true;
        return { ...msg, content: msg.content.replace(PLACEHOLDERS, () => nickname) };
    });
    return changed ? out : messages;
}
