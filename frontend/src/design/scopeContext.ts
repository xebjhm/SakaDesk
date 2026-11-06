import React, { type CSSProperties } from 'react';

/** `brand`: set by BrandScope and a brand Modal. `group`: one service's scope (its login) handed to a portalled child dialog. */
export interface ScopeValue { scope: 'brand' | 'group'; style: CSSProperties }

/** Lets portalled dialogs inherit the brand context, or a group scope a parent passes explicitly. */
export const ScopeContext = React.createContext<ScopeValue | null>(null);

export function useScope(): ScopeValue | null {
    return React.useContext(ScopeContext);
}
