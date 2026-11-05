import React, { type CSSProperties } from 'react';

export interface ScopeValue { scope: 'brand'; style: CSSProperties }

/** Set by BrandScope and by a brand Modal so portalled dialogs can inherit the brand context. */
export const ScopeContext = React.createContext<ScopeValue | null>(null);

export function useScope(): ScopeValue | null {
    return React.useContext(ScopeContext);
}
