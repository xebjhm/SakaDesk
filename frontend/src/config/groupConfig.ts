// src/config/groupConfig.ts
// Per-service configuration for group chat handling

import type { GroupId } from './groupThemes';

// Group chat IDs by service (groups that are communal chats rather than individual member chats)
export const GROUP_CHAT_IDS: Record<GroupId, string[]> = {
  hinatazaka: ['43'], // 日向坂46 group chat
  sakurazaka: ['45'], // 櫻坂46 group chat (TBD - confirm actual ID)
  nogizaka: ['46'],   // 乃木坂46 group chat (TBD - confirm actual ID)
  yodel: [],          // Yodel group chats (TBD)
  default: [],
};

/**
 * Check if a group ID represents a group chat for the given service
 */
export function isGroupChat(groupId: string, serviceId: string | null): boolean {
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
