/**
 * Writes design tokens to the document as CSS custom properties.
 *
 * - applyStaticTokens(): group-independent --ds-* variables. main.tsx calls it
 *   once, synchronously, before the first render of every entry point.
 * - applyGroupTokens(): the --ds-group-* variables. App.tsx calls it with
 *   the active service's group, or with the neutral `default` group until
 *   ToS is accepted and a group is chosen.
 */
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
    clientLog('design_tokens_applied', { theme: groupId });
}
