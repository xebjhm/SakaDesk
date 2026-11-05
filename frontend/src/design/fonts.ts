/**
 * Language-aware font stacks (spec §6). The UI language picks the glyph set
 * (JP / TC / HK / SC / Latin); Japanese content keeps JP glyphs through
 * `:lang(ja)` in index.css. Only the active language's family is loaded.
 */
import i18n from '../i18n';
import type { SupportedLanguage } from '../i18n';
import { clientLog } from '../utils/clientLog';

interface FontStack { sans: string; serif: string; google: string }

const JP_FALLBACK = '"Noto Sans JP", system-ui, -apple-system, sans-serif';
const SERIF_FALLBACK = '"Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif';
const W = 'wght@400;500;600;700';

export const fontStacks: Record<SupportedLanguage, FontStack> = {
    ja: { sans: JP_FALLBACK, serif: SERIF_FALLBACK, google: `family=Noto+Sans+JP:${W}&family=Noto+Serif+JP:${W}` },
    'zh-TW': { sans: `"Noto Sans TC", ${JP_FALLBACK}`, serif: `"Noto Serif TC", ${SERIF_FALLBACK}`, google: `family=Noto+Sans+TC:${W}&family=Noto+Serif+TC:${W}` },
    yue: { sans: `"Noto Sans HK", ${JP_FALLBACK}`, serif: `"Noto Serif HK", ${SERIF_FALLBACK}`, google: `family=Noto+Sans+HK:${W}&family=Noto+Serif+HK:${W}` },
    'zh-CN': { sans: `"Noto Sans SC", ${JP_FALLBACK}`, serif: `"Noto Serif SC", ${SERIF_FALLBACK}`, google: `family=Noto+Sans+SC:${W}&family=Noto+Serif+SC:${W}` },
    en: { sans: `"Noto Sans", ${JP_FALLBACK}`, serif: `"Noto Serif", ${SERIF_FALLBACK}`, google: `family=Noto+Sans:${W}&family=Noto+Serif:${W}` },
};

function stackFor(lang: string): FontStack {
    return (fontStacks as Record<string, FontStack>)[lang] ?? fontStacks.en;
}

export function applyLanguageFonts(lang: string, doc: Document = document): void {
    const stack = stackFor(lang);
    const root = doc.documentElement;
    root.style.setProperty('--ds-font-family-sans', stack.sans);
    root.style.setProperty('--ds-font-family-serif', stack.serif);
    root.lang = lang;
    let link = doc.getElementById('ds-fonts') as HTMLLinkElement | null;
    if (!link) {
        link = doc.createElement('link');
        link.id = 'ds-fonts';
        link.rel = 'stylesheet';
        doc.head.appendChild(link);
    }
    link.href = `https://fonts.googleapis.com/css2?${stack.google}&display=swap`;
    clientLog('design_fonts_applied', { target: (lang in fontStacks) ? lang : 'fallback_en' });
}

/** Applies the current language now and on every change. Call once per entry point. */
export function installLanguageFonts(): void {
    applyLanguageFonts(i18n.language);
    i18n.on('languageChanged', (lng: string) => applyLanguageFonts(lng));
}
