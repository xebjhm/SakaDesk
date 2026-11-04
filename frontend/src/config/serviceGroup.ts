import type { GroupId } from '../design/tokens';

/** Group of a service id (`hinatazaka46` → `hinatazaka`); unknown or none → `default`. */
export function serviceGroupId(serviceId: string | null): GroupId {
    const s = (serviceId ?? '').toLowerCase();
    if (s.includes('hinata')) return 'hinatazaka';
    if (s.includes('sakura')) return 'sakurazaka';
    if (s.includes('nogi')) return 'nogizaka';
    if (s.includes('yodel')) return 'yodel';
    return 'default';
}
