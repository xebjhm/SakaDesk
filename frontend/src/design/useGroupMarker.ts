import { useEffect, useMemo, type CSSProperties } from 'react';
import { groupScopeStyle } from './groupScope';
import { serviceGroupId } from '../config/serviceGroup';
import { clientLog } from '../utils/clientLog';

/** Where a group marker sits; logged when its service is unknown. */
export type GroupMarkerTarget = 'add_service' | 'settings_row';

/**
 * Group scope for one piece of a brand dialog that names one service (a group card, a per-group
 * settings row: docs/design/DESIGN_SYSTEM.md, "Contexts"). Inside it every `*-accent-*` and
 * `*-group-*` utility follows that service's group. An unknown service has no group: the piece
 * stays in the surrounding (brand) context and one `group_marker_fallback` breadcrumb is logged.
 */
export function useGroupMarker(serviceId: string | null, target: GroupMarkerTarget): CSSProperties | undefined {
    const groupId = serviceGroupId(serviceId);
    const style = useMemo(() => (groupId === 'default' ? undefined : groupScopeStyle(groupId)), [groupId]);
    useEffect(() => {
        if (groupId === 'default') clientLog('group_marker_fallback', { target, reason: 'unknown_service' });
    }, [groupId, target]);
    return style;
}
