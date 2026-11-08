import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));

import { clientLog } from '../utils/clientLog';
import legacy from './__fixtures__/legacy-theme-values.json';
import { GROUP_IDS, groupRoles, groupTokens } from './tokens';
import { staticTokenVars, groupTokenVars } from './cssVars';
import { applyStaticTokens, applyGroupTokens } from './applyTokens';

const style = () => document.documentElement.style;

describe('cssVars', () => {
    it('maps every static token to a --ds- variable', () => {
        const vars = staticTokenVars();
        expect(vars['--ds-surface-sheet']).toBe('#FFFFFF');
        expect(vars['--ds-radius-sheet']).toBe('24px');
        expect(vars['--ds-radius-md']).toBe('12px');
        expect(vars['--ds-font-body-size']).toBe('14px');
        expect(vars['--ds-font-body-leading']).toBe('22px');
        expect(vars['--ds-duration-base']).toBe('200ms');
        expect(vars['--ds-ease-standard']).toBe('cubic-bezier(0.2, 0, 0, 1)');
        expect(Object.keys(vars).every((k) => k.startsWith('--ds-'))).toBe(true);
        expect(vars['--ds-overlay-scrim']).toBe('rgba(0, 0, 0, 0.4)');
        expect(Object.keys(vars)).toHaveLength(6 + 4 + 2 + 1 + 3 + 5 + 4 + 12 + 2 + 1 + 2 + 3 + 1 + 3 + 1 + 4 + 7 + 2 + 1 + 1 - 3 - 4 + 20 + 6 + 2 + 2 + 1 + 2 + 1 + 4 + 1 + 1 + 14 + 3 + 2 + 8); // developer console (+8: bg, text, muted text, prompt, error, warning, badge, badge text); rail lens duration + centre (+2); blog feed segmented control (+3: track, shadow, size); blog feed tile (+14: 6 caption sizes, 2 shadows, glass + border + vignette, 2 durations, spring); frost hairline (+1), frost (+1), oshi (+4), star (+1); toast duration (+1); radius 11 (was 5); semantic (4 kinds x 5 steps) replaces feedback (3) and status (4); display step (+2 vars) and sans/serif family defaults (+2); header pill overlays (+2)
        expect(vars['--ds-duration-glide']).toBe('400ms');
        expect(vars['--ds-duration-landing']).toBe('1400ms');
        expect(vars['--ds-duration-toast']).toBe('350ms');
    });

    it.each(GROUP_IDS)('maps every %s group token', (id) => {
        const vars = groupTokenVars(id);
        const o = groupTokens[id].official;
        const r = groupRoles(id);
        expect(vars['--ds-group-canvas']).toBe(
            `linear-gradient(to bottom, ${o.canvas[0]}, ${o.canvas[1]}, ${o.canvas[2]})`,
        );
        expect(vars['--ds-group-badge']).toBe(r.action);
        expect(vars['--ds-group-bubble-border']).toBe(r.bubbleBorder);
        expect(Object.keys(vars)).toHaveLength(27 + 19 + 1 + 4 + 2 + 1 + 2 + 1 + 1); // header-button focus ring (+1); rail beacon (+1); blog tile + caption hover glows (+2); accent halo (+1); shelters (+4); accent wash + wash border (+2); progress (+1)
        expect(vars['--ds-group-highlight']).toBe(r.highlight);
        expect(vars['--ds-shadow-group-glow']).toBe(`0 0 12px 2px ${r.glow}`);
    });
});

describe('applyStaticTokens', () => {
    it('writes every static variable on :root', () => {
        applyStaticTokens();
        for (const [name, value] of Object.entries(staticTokenVars())) {
            expect(style().getPropertyValue(name)).toBe(value);
        }
    });
});

describe('applyGroupTokens', () => {
    beforeEach(() => vi.mocked(clientLog).mockClear());

    it.each(GROUP_IDS)('writes %s group and legacy variables and logs', (id) => {
        applyGroupTokens(id);
        for (const [name, value] of Object.entries(groupTokenVars(id))) {
            expect(style().getPropertyValue(name)).toBe(value);
        }
        const changed = ['--color-success', '--color-warning', '--color-error', '--color-primary', '--color-secondary', '--color-accent', '--color-gradient-from', '--color-gradient-to'];
        for (const [name, value] of Object.entries(legacy.cssVars[id])) {
            if (!changed.includes(name)) expect(style().getPropertyValue(name)).toBe(value);
        }
        const r = groupRoles(id);
        expect(style().getPropertyValue('--color-primary')).toBe(r.logo);
        expect(style().getPropertyValue('--color-secondary')).toBe(r.action);
        expect(clientLog).toHaveBeenCalledWith('design_tokens_applied', { theme: id });
    });
});

import { accentTokenVars } from './cssVars';
import { brandAccent, groupAccent, aurora } from './tokens';

describe('accent CSS variables', () => {
    it('maps every role to a --ds-accent-* / --ds-expressive-* variable', () => {
        const a = brandAccent();
        const v = accentTokenVars(a);
        expect(v['--ds-accent']).toBe(a.accent);
        expect(v['--ds-accent-strong']).toBe(a.strong);
        expect(v['--ds-accent-subtle']).toBe(a.subtle);
        expect(v['--ds-accent-border']).toBe(a.border);
        expect(v['--ds-accent-gradient']).toBe(a.gradient);
        expect(v['--ds-accent-tonal']).toBe(a.tonal);
        expect(v['--ds-accent-tonal-text']).toBe(a.tonalText);
        expect(v['--ds-shadow-accent-glow']).toBe(`0 4px 14px ${a.glow}`);
        expect(v['--ds-shadow-accent-halo']).toBe(`0 0 12px 2px ${a.glow}`);
        expect(v['--ds-shadow-accent-glow-hover']).toBe(`0 6px 22px ${a.glow}`);
        expect(v['--ds-shadow-accent-unread']).toBe(a.unread);
        expect(v['--ds-expressive-soft']).toBe(a.soft);
        expect(v['--ds-expressive-header']).toBe(a.header);
        expect(v['--ds-expressive-header-text']).toBe(a.headerText);
        expect(v['--ds-expressive-header-focus']).toBe(a.headerFocus);
        expect(v['--ds-expressive-header-bar']).toBe(a.headerBar);
        expect(v['--ds-expressive-orb-1']).toBe(a.orb1);
    });
    it('group vars include that group\'s accent vars', () => {
        expect(groupTokenVars('sakurazaka')).toMatchObject(accentTokenVars(groupAccent('sakurazaka')));
    });
    it('the aurora is a static variable', () => {
        expect(staticTokenVars()['--ds-aurora']).toBe(aurora.gradient);
    });
});
