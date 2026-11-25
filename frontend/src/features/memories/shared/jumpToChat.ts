import { openChat } from '../../../shell/openChat';
import { logMemoriesJump, type MemoriesView } from '../memoriesLog';
import type { MemoryMessage } from '../types';

/**
 * Open her 1:1 chat at `msg` (the chat scrolls to it) and log `memories_jump` with the source
 * view only: never the path or her name.
 */
export function jumpToChat(msg: MemoryMessage, name: string, from: MemoriesView): void {
    openChat({ service: msg.service, path: msg.member_path, name, is_group_chat: false, message_id: msg.id });
    logMemoriesJump(from, true);
}
