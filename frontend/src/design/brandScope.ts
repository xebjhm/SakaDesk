import React, { type CSSProperties } from 'react';
import { accentTokenVars } from './cssVars';
import { brandAccent } from './tokens';

/**
 * Inline custom properties that make every accent / expressive utility inside an element use
 * the SakaDesk brand (ink + aurora) whatever group is active (docs/design/DESIGN_SYSTEM.md,
 * "Contexts"). Brand screens and app-level dialogs apply it to themselves.
 */
export function brandScopeStyle(): CSSProperties {
    return accentTokenVars(brandAccent()) as CSSProperties;
}

export const BrandScope: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) =>
    React.createElement('div', { 'data-scope': 'brand', className, style: brandScopeStyle() }, children);
