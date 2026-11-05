import type { CSSProperties } from 'react';
import { groupTokenVars } from './cssVars';
import type { GroupId } from './tokens';

/**
 * Inline custom properties that make every `*-group-*` utility inside an element follow
 * `groupId` instead of the active group (docs/design/DESIGN_SYSTEM.md, "Group scope").
 * Only for a surface that belongs to one specific service: its login dialog, its sync.
 */
export function groupScopeStyle(groupId: GroupId): CSSProperties {
    return groupTokenVars(groupId) as CSSProperties;
}
