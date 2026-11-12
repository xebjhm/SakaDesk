import type { Message } from '../../../types';
import type { MemoryMessage } from '../types';

/**
 * A Memories message object as the chat's `Message`, so `MessageBubble` renders it. `content` is
 * her raw text (apply the nickname as the chat does); `media_file` and `duration_s` map to the
 * chat's fields; `favorited` to `is_favorite`.
 *
 * `Message` has no caption or avatar field, so `caption` (a picture's words kept in a paired
 * message, `caption_id`) and `avatar_url` are not carried: callers that show a picture or video
 * render `m.caption` (with `MemoryText`) and the avatar beside the bubble themselves.
 */
export function toChatMessage(m: MemoryMessage): Message {
    const out: Message = {
        id: m.id,
        timestamp: m.ts,
        type: m.type,
        is_favorite: m.favorited,
        content: m.text,
    };
    if (m.media_file) out.media_file = m.media_file;
    if (m.duration_s !== null) out.media_duration = m.duration_s;
    return out;
}
