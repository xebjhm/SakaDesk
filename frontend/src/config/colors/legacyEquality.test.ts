import { describe, it, expect } from 'vitest';
import legacy from '../../design/__fixtures__/legacy-theme-values.json';
import { GROUP_IDS, groupTokens } from '../../design/tokens';
import { serviceThemes } from '../serviceThemes';
import { generateThemeCSSVariables, UI_TOKENS } from './index';

describe('legacy theme reads the tokens without changing values', () => {
    it.each(GROUP_IDS)('%s CSS variables are byte-identical to pre-D1', (id) => {
        expect(generateThemeCSSVariables(id)).toEqual(legacy.cssVars[id]);
    });

    it.each(GROUP_IDS)('%s serviceThemes brand fields are byte-identical to pre-D1', (id) => {
        const t = serviceThemes[id];
        const want = legacy.groups[id];
        expect(t.primaryColor).toBe(want.accent);
        expect(t.messages.sidebarGradient).toEqual(want.canvas);
        expect(t.messages.headerGradient).toEqual(want.titleGradient);
        expect(t.messages.headerBarGradient).toBe(want.titleBar);
        expect(t.messages.headerTextColor).toBe(want.titleText);
        expect(t.interaction.focusRing).toBe(want.ring);
        expect(t.interaction.hoverGlow).toBe(want.glow);
        expect(t.messages.bubbleBorder).toBe(want.bubbleBorder);
        expect(t.messages.unreadBadge).toBe(want.badge);
    });

    it.each(GROUP_IDS)('%s serviceThemes brand fields come from groupTokens', (id) => {
        expect(serviceThemes[id].primaryColor).toBe(groupTokens[id].accent);
        expect(serviceThemes[id].messages.unreadBadge).toBe(groupTokens[id].badge);
    });

    it('border tokens are unchanged', () => {
        expect(UI_TOKENS.border).toEqual(legacy.border);
    });
});
