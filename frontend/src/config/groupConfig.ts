// src/config/groupConfig.ts
// Per-service configuration for group chat handling

import type { GroupId } from './serviceThemes';

// Group chat IDs by service (groups that are communal chats rather than
// individual member chats).
//
// UNVERIFIED: only the hinatazaka id ('43') is confirmed. The sakurazaka ('45')
// and nogizaka ('46') ids are guesses ("TBD - confirm actual ID") and MUST NOT
// be trusted as authoritative. Prefer the backend `Group.is_group_chat` flag
// (types/index.ts) wherever it is available — this list is only a fallback for
// callers that lack the flag. Do not add new unverified ids here.
export const GROUP_CHAT_IDS: Record<GroupId, string[]> = {
  hinatazaka: ['43'], // 日向坂46 group chat (confirmed)
  sakurazaka: ['45'], // 櫻坂46 group chat (UNVERIFIED - confirm actual ID)
  nogizaka: ['46'],   // 乃木坂46 group chat (UNVERIFIED - confirm actual ID)
  yodel: [],          // Yodel group chats (TBD)
  default: [],
};

/**
 * Check if a group represents a group chat.
 *
 * Prefers an explicit backend `is_group_chat` flag when one is passed, since the
 * hardcoded {@link GROUP_CHAT_IDS} list contains unverified ids. Falls back to
 * the per-service id list only when no explicit flag is available.
 *
 * @param groupId     the group id
 * @param serviceId   the owning service (null = check across all services)
 * @param explicitFlag optional authoritative `Group.is_group_chat` flag
 */
export function isGroupChat(
  groupId: string,
  serviceId: string | null,
  explicitFlag?: boolean,
): boolean {
  // Trust the backend flag over the unverified hardcoded id list when present.
  if (explicitFlag !== undefined) return explicitFlag;

  if (!serviceId) {
    // If no service specified, check all services
    return Object.values(GROUP_CHAT_IDS).flat().includes(groupId);
  }

  const serviceLower = serviceId.toLowerCase();
  let groupKey: GroupId = 'default';

  if (serviceLower.includes('hinata')) {
    groupKey = 'hinatazaka';
  } else if (serviceLower.includes('sakura')) {
    groupKey = 'sakurazaka';
  } else if (serviceLower.includes('nogi')) {
    groupKey = 'nogizaka';
  } else if (serviceLower.includes('yodel')) {
    groupKey = 'yodel';
  }

  return GROUP_CHAT_IDS[groupKey].includes(groupId);
}

/**
 * Get all group chat IDs for a service
 */
export function getGroupChatIds(serviceId: string | null): string[] {
  if (!serviceId) {
    return Object.values(GROUP_CHAT_IDS).flat();
  }

  const serviceLower = serviceId.toLowerCase();

  if (serviceLower.includes('hinata')) {
    return GROUP_CHAT_IDS.hinatazaka;
  }
  if (serviceLower.includes('sakura')) {
    return GROUP_CHAT_IDS.sakurazaka;
  }
  if (serviceLower.includes('nogi')) {
    return GROUP_CHAT_IDS.nogizaka;
  }
  if (serviceLower.includes('yodel')) {
    return GROUP_CHAT_IDS.yodel;
  }

  return GROUP_CHAT_IDS.default;
}
