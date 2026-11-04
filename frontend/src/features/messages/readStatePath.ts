import { getServiceIdFromDisplayName } from '../../data/services';

export interface ReadStatePath {
    service: string;
    groupId: number;
    memberId: number;
}

// Parse path into API params. Handles both:
//   Individual: "日向坂46/messages/34 金村 美玖/58 金村 美玖" → memberId=58
//   Group chat: "日向坂46/messages/43 日向坂46"               → memberId=0
export function parseReadStatePath(path: string): ReadStatePath | null {
    // Try individual path first (has member subdirectory)
    const individualMatch = path.match(/^(.+?)\/messages\/(\d+)\s.*?\/(\d+)\s/);
    if (individualMatch) {
        const serviceId = getServiceIdFromDisplayName(individualMatch[1]);
        if (!serviceId) return null;
        return { service: serviceId, groupId: parseInt(individualMatch[2], 10), memberId: parseInt(individualMatch[3], 10) };
    }
    // Group chat path (no member subdirectory)
    const groupMatch = path.match(/^(.+?)\/messages\/(\d+)\s/);
    if (groupMatch) {
        const serviceId = getServiceIdFromDisplayName(groupMatch[1]);
        if (!serviceId) return null;
        return { service: serviceId, groupId: parseInt(groupMatch[2], 10), memberId: 0 };
    }
    return null;
}
