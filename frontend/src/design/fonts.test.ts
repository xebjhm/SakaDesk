import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));

import { applyLanguageFonts, fontStacks } from './fonts';
import { typeScale } from './tokens';

describe('language-aware fonts', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
        document.documentElement.removeAttribute('style');
    });
    it.each([
        ['ja', 'Noto Sans JP', 'Noto Serif JP'],
        ['zh-TW', 'Noto Sans TC', 'Noto Serif TC'],
        ['yue', 'Noto Sans HK', 'Noto Serif HK'],
        ['zh-CN', 'Noto Sans SC', 'Noto Serif SC'],
        ['en', 'Noto Sans', 'Noto Serif'],
    ])('%s uses %s / %s first', (lang, sans, serif) => {
        applyLanguageFonts(lang);
        const root = document.documentElement;
        expect(root.style.getPropertyValue('--ds-font-family-sans').startsWith(`"${sans}"`)).toBe(true);
        expect(root.style.getPropertyValue('--ds-font-family-serif').startsWith(`"${serif}"`)).toBe(true);
        expect(root.lang).toBe(lang);
    });
    it('keeps Noto Sans JP as the fallback for Japanese content in every stack', () => {
        for (const stack of Object.values(fontStacks)) expect(stack.sans).toContain('"Noto Sans JP"');
    });
    it('loads only the active language family through one link', () => {
        applyLanguageFonts('zh-TW');
        applyLanguageFonts('ja');
        const links = document.head.querySelectorAll('link#ds-fonts');
        expect(links).toHaveLength(1);
        expect((links[0] as HTMLLinkElement).href).toContain('Noto+Sans+JP');
        expect((links[0] as HTMLLinkElement).href).not.toContain('Noto+Sans+TC');
    });
    it('falls back to English stacks for an unknown language', () => {
        applyLanguageFonts('xx');
        expect(document.documentElement.style.getPropertyValue('--ds-font-family-sans').startsWith('"Noto Sans"')).toBe(true);
    });
    it('adds the display step', () => {
        expect(typeScale.display).toEqual({ size: '32px', leading: '40px' });
    });
});
