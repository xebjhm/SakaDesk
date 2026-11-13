import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));

import i18n from '../i18n';
import { applyLanguageFonts, faceLoaders, fontStacks, installLanguageFonts, isCjkLanguage, langStackVar, loadLanguageFaces, writeLanguageStacks, type FaceLoaders } from './fonts';
import { typeScale } from './tokens';
import { clientLog } from '../utils/clientLog';

function fakeLoaders(): FaceLoaders {
    return {
        ja: null,
        'zh-TW': vi.fn().mockResolvedValue(undefined),
        yue: vi.fn().mockResolvedValue(undefined),
        'zh-CN': vi.fn().mockResolvedValue(undefined),
        en: vi.fn().mockResolvedValue(undefined),
    };
}

const sans = () => document.documentElement.style.getPropertyValue('--ds-font-family-sans');

describe('language-aware fonts', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
        document.documentElement.removeAttribute('style');
        vi.mocked(clientLog).mockClear();
    });
    it.each([
        ['ja', 'Noto Sans JP Variable', 'Noto Serif JP Variable'],
        ['zh-TW', 'Noto Sans TC Variable', 'Noto Serif TC Variable'],
        ['yue', 'Noto Sans HK Variable', 'Noto Serif HK Variable'],
        ['zh-CN', 'Noto Sans SC Variable', 'Noto Serif SC Variable'],
        ['en', 'Noto Sans Variable', 'Noto Serif Variable'],
    ])('%s uses %s / %s first', (lang, sansFace, serifFace) => {
        applyLanguageFonts(lang, document, fakeLoaders());
        const root = document.documentElement;
        expect(root.style.getPropertyValue('--ds-font-family-sans').startsWith(`"${sansFace}"`)).toBe(true);
        expect(root.style.getPropertyValue('--ds-font-family-serif').startsWith(`"${serifFace}"`)).toBe(true);
        expect(root.lang).toBe(lang);
    });
    it('keeps the Japanese face as the fallback of every stack', () => {
        for (const stack of Object.values(fontStacks)) expect(stack.sans).toContain('"Noto Sans JP Variable"');
    });
    it('requests only the active language faces', () => {
        const loaders = fakeLoaders();
        applyLanguageFonts('zh-TW', document, loaders);
        applyLanguageFonts('ja', document, loaders);
        expect(loaders['zh-TW']).toHaveBeenCalledTimes(1);
        for (const lang of ['yue', 'zh-CN', 'en'] as const) expect(loaders[lang]).not.toHaveBeenCalled();
    });
    it('has faces to load for every language but Japanese', () => {
        expect(faceLoaders.ja).toBeNull();
        for (const lang of ['zh-TW', 'yue', 'zh-CN', 'en'] as const) expect(typeof faceLoaders[lang]).toBe('function');
    });
    it('never adds a stylesheet from another origin', () => {
        applyLanguageFonts('zh-CN', document, fakeLoaders());
        expect(document.head.querySelectorAll('link')).toHaveLength(0);
    });
    it('falls back to the English stacks and faces for an unknown language', () => {
        const loaders = fakeLoaders();
        applyLanguageFonts('xx', document, loaders);
        expect(sans().startsWith('"Noto Sans Variable"')).toBe(true);
        expect(loaders.en).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('design_fonts_applied', { target: 'fallback_en' });
    });
    it('treats an inherited property name as an unknown language', () => {
        applyLanguageFonts('toString', document, fakeLoaders());
        expect(sans().startsWith('"Noto Sans Variable"')).toBe(true);
        expect(clientLog).toHaveBeenCalledWith('design_fonts_applied', { target: 'fallback_en' });
    });
    it('logs a code-safe breadcrumb, and a fallback when the faces fail to load', async () => {
        const loaders = fakeLoaders();
        (loaders['zh-TW'] as Mock).mockRejectedValue(new Error('chunk failed'));
        applyLanguageFonts('zh-TW', document, loaders);
        expect(clientLog).toHaveBeenCalledWith('design_fonts_applied', { target: 'zh_tw' });
        await vi.waitFor(() => expect(clientLog).toHaveBeenCalledWith('design_fonts_fallback', { target: 'zh_tw' }));
    });
    it('adds the display step', () => {
        expect(typeScale.display).toEqual({ size: '32px', leading: '40px' });
    });
    it('installLanguageFonts applies the current language now and re-applies on change', async () => {
        const original = i18n.language;
        const onSpy = vi.spyOn(i18n, 'on');
        try {
            await i18n.changeLanguage('ja');
            installLanguageFonts(fakeLoaders());
            expect(sans().startsWith('"Noto Sans JP Variable"')).toBe(true);
            expect(document.documentElement.lang).toBe('ja');
            await i18n.changeLanguage('zh-TW');
            expect(sans().startsWith('"Noto Sans TC Variable"')).toBe(true);
            expect(document.documentElement.lang).toBe('zh-TW');
        } finally {
            for (const [event, handler] of onSpy.mock.calls) i18n.off(event, handler as never);
            onSpy.mockRestore();
            await i18n.changeLanguage(original);
        }
    });
});

describe('per-language stacks as variables (UI health #10)', () => {
    it('writes every language stack once on the root', () => {
        writeLanguageStacks(document);
        const style = document.documentElement.style;
        expect(style.getPropertyValue('--ds-font-sans-zh-tw')).toBe(fontStacks['zh-TW'].sans);
        expect(style.getPropertyValue('--ds-font-serif-yue')).toBe(fontStacks.yue.serif);
        expect(style.getPropertyValue('--ds-font-sans-ja')).toBe(fontStacks.ja.sans);
        expect(langStackVar('zh-CN', 'sans')).toBe('--ds-font-sans-zh-cn');
    });

    it("loads a translation language's faces on request, once per loader call, and ignores unknown codes", () => {
        const loader = vi.fn(() => Promise.resolve());
        const loaders = { ja: null, 'zh-TW': loader, yue: null, 'zh-CN': null, en: null };
        loadLanguageFaces('zh-TW', loaders);
        loadLanguageFaces('xx', loaders);
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it('logs a breadcrumb when a requested face fails to load', async () => {
        const loaders = { ja: null, 'zh-TW': () => Promise.reject(new Error('x')), yue: null, 'zh-CN': null, en: null };
        loadLanguageFaces('zh-TW', loaders);
        await vi.waitFor(() => expect(clientLog).toHaveBeenCalledWith('design_fonts_fallback', { target: 'zh_tw' }));
    });

    it('knows which languages are CJK', () => {
        expect(['ja', 'zh-TW', 'zh-CN', 'yue', 'ko'].every(isCjkLanguage)).toBe(true);
        expect(isCjkLanguage('en')).toBe(false);
        expect(isCjkLanguage(null)).toBe(false);
    });
});
