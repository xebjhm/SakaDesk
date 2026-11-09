import type { Message } from '../../../types';

// ASCII %%% (U+0025) and fullwidth ％％％ (U+FF05) stand for the user's nickname.
const HAS_PLACEHOLDER = /%%%|％％％/;
const PLACEHOLDERS = /%%%|％％％/g;

/** Replace every nickname placeholder in one string (inserted literally, no `$` patterns). */
export function replaceNickname(text: string, nickname: string): string {
    return text.replace(PLACEHOLDERS, () => nickname);
}

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
        return { ...msg, content: replaceNickname(msg.content, nickname) };
    });
    return changed ? out : messages;
}
