import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import legacy from '../../design/__fixtures__/legacy-theme-values.json';
import { GROUP_IDS, groupRoles, groupTokens } from '../../design/tokens';
import { serviceThemes } from '../serviceThemes';
import { generateThemeCSSVariables, UI_TOKENS } from './index';

// v2 harmonized the feedback colours on purpose; the pre-D1 values no longer apply.
const FEEDBACK_VARS = ['--color-success', '--color-warning', '--color-error'];
const GROUP_VARS = ['--color-primary', '--color-secondary', '--color-accent', '--color-gradient-from', '--color-gradient-to'];

describe('legacy theme is a view of the design tokens', () => {
    it.each(GROUP_IDS)('%s neutral CSS variables are unchanged', (id) => {
        const vars = generateThemeCSSVariables(id);
        const want = legacy.cssVars[id] as Record<string, string>;
        for (const [name, value] of Object.entries(want)) {
            if (!GROUP_VARS.includes(name) && !FEEDBACK_VARS.includes(name)) expect(vars[name]).toBe(value);
        }
    });

    it.each(GROUP_IDS)('%s group CSS variables follow the roles', (id) => {
        const vars = generateThemeCSSVariables(id);
        const r = groupRoles(id);
        expect(vars['--color-primary']).toBe(r.logo);
        expect(vars['--color-secondary']).toBe(r.action);
        expect(vars['--color-accent']).toBe(r.subtle);
        expect(vars['--color-gradient-from']).toBe(r.logo);
        expect(vars['--color-gradient-to']).toBe(r.action);
    });

    it.each(GROUP_IDS)('%s official fields are byte-identical to the official values', (id) => {
        const t = serviceThemes[id];
        const want = legacy.groups[id];
        expect(t.messages.headerGradient).toEqual(want.titleGradient);
        expect(t.messages.headerBarGradient).toBe(want.titleBar);
        expect(t.messages.headerTextColor).toBe(want.titleText);
        expect(t.messages.sidebarGradient).toEqual(want.canvas);
        expect(t.messages.shelterColors).toEqual(groupTokens[id].official.shelter);
    });

    it.each(GROUP_IDS)('%s system fields come from the roles', (id) => {
        const t = serviceThemes[id];
        const r = groupRoles(id);
        expect(t.primaryColor).toBe(r.logo);
        expect([t.messages.unreadBadge, t.messages.voicePlayerAccent, t.messages.scrollButtonColor]).toEqual([r.action, r.action, r.action]);
        expect(t.messages.bubbleBorder).toBe(r.bubbleBorder);
    });

    it('serviceThemes.ts contains no hand-written colour', () => {
        const source = readFileSync(path.resolve(__dirname, '../serviceThemes.ts'), 'utf-8');
        expect(source.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)).toBeNull();
    });

    it('border tokens are unchanged', () => {
        expect(UI_TOKENS.border).toEqual(legacy.border);
    });
});
