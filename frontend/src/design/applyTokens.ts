/**
 * Writes design tokens to the document as CSS custom properties.
 *
 * - applyStaticTokens(): group-independent --ds-* variables. main.tsx calls it
 *   once, synchronously, before the first render of every entry point.
 * - applyGroupTokens(): --ds-group-* variables plus the legacy --color-*
 *   variables (identical values) so pre-D1 Tailwind classes keep working.
 *   App.tsx calls it whenever the active service changes.
 */
import { generateThemeCSSVariables } from '../config/colors/css-variables';
import { clientLog } from '../utils/clientLog';
import { groupTokenVars, staticTokenVars } from './cssVars';
import type { GroupId } from './tokens';

function write(root: HTMLElement, vars: Record<string, string>): void {
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}

export function applyStaticTokens(root: HTMLElement = document.documentElement): void {
    write(root, staticTokenVars());
}

export function applyGroupTokens(groupId: GroupId, root: HTMLElement = document.documentElement): void {
    write(root, groupTokenVars(groupId));
    write(root, generateThemeCSSVariables(groupId));
    clientLog('design_tokens_applied', { theme: groupId });
}
