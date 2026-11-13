/**
 * Language-aware font stacks (spec §6). The UI language picks the glyph set
 * (JP / TC / HK / SC / Latin); Japanese content keeps JP glyphs through
 * `[lang="ja"]` content rules in index.css.
 *
 * Every face is self-hosted: the @fontsource-variable packages are bundled by Vite into
 * /assets in `unicode-range` slices (a page fetches only the slices its text uses), so text
 * never waits on a third-party host and the Content-Security-Policy allows fonts only from
 * the app (security audit 2026-11-13; UI health report: render-blocking Google Fonts). The
 * Japanese faces load with every entry point, since Japanese content is everywhere; another
 * language's faces are their own stylesheet chunk, requested when that language is applied.
 */
import '@fontsource-variable/noto-sans-jp';
import '@fontsource-variable/noto-serif-jp';
import i18n from '../i18n';
import type { SupportedLanguage } from '../i18n';
import { fontFamily } from './tokens/type';
import { clientLog } from '../utils/clientLog';

interface FontStack { sans: string; serif: string }

const JP_FALLBACK = fontFamily.sansJp;
const SERIF_FALLBACK = fontFamily.reading;

export const fontStacks: Record<SupportedLanguage, FontStack> = {
    ja: { sans: JP_FALLBACK, serif: SERIF_FALLBACK },
    'zh-TW': { sans: `"Noto Sans TC Variable", ${JP_FALLBACK}`, serif: `"Noto Serif TC Variable", ${SERIF_FALLBACK}` },
    yue: { sans: `"Noto Sans HK Variable", ${JP_FALLBACK}`, serif: `"Noto Serif HK Variable", ${SERIF_FALLBACK}` },
    'zh-CN': { sans: `"Noto Sans SC Variable", ${JP_FALLBACK}`, serif: `"Noto Serif SC Variable", ${SERIF_FALLBACK}` },
    en: { sans: `"Noto Sans Variable", ${JP_FALLBACK}`, serif: `"Noto Serif Variable", ${SERIF_FALLBACK}` },
};

/** Loads one language's own faces (a stylesheet chunk); resolves once it is in. */
export type FaceLoader = () => Promise<unknown>;
export type FaceLoaders = Record<SupportedLanguage, FaceLoader | null>;

/** Each language's own faces. Japanese has none to load: its faces are imported above. */
export const faceLoaders: FaceLoaders = {
    ja: null,
    'zh-TW': () => Promise.all([import('@fontsource-variable/noto-sans-tc'), import('@fontsource-variable/noto-serif-tc')]),
    yue: () => Promise.all([import('@fontsource-variable/noto-sans-hk'), import('@fontsource-variable/noto-serif-hk')]),
    'zh-CN': () => Promise.all([import('@fontsource-variable/noto-sans-sc'), import('@fontsource-variable/noto-serif-sc')]),
    en: () => Promise.all([import('@fontsource-variable/noto-sans'), import('@fontsource-variable/noto-serif')]),
};

function knownLanguage(lang: string): SupportedLanguage | null {
    return Object.prototype.hasOwnProperty.call(fontStacks, lang) ? (lang as SupportedLanguage) : null;
}

/**
 * Applies `lang`'s stacks to the root font variables and requests its faces; an unknown
 * language gets the English stacks and faces. Logs `design_fonts_applied`, and
 * `design_fonts_fallback` when the faces fail to load (the stack's next font then renders).
 */
export function applyLanguageFonts(lang: string, doc: Document = document, loaders: FaceLoaders = faceLoaders): void {
    const known = knownLanguage(lang);
    const key: SupportedLanguage = known ?? 'en';
    const stack = fontStacks[key];
    const root = doc.documentElement;
    root.style.setProperty('--ds-font-family-sans', stack.sans);
    root.style.setProperty('--ds-font-family-serif', stack.serif);
    root.lang = lang;
    // Code-safe breadcrumb value (client-log values match ^[a-z0-9_]{1,40}$).
    const target = known ? known.toLowerCase().replace(/-/g, '_') : 'fallback_en';
    loaders[key]?.().catch(() => clientLog('design_fonts_fallback', { target }));
    clientLog('design_fonts_applied', { target });
}

/** Applies the current language now and on every change. Call once per entry point. */
export function installLanguageFonts(loaders: FaceLoaders = faceLoaders): void {
    applyLanguageFonts(i18n.language, document, loaders);
    i18n.on('languageChanged', (lng: string) => applyLanguageFonts(lng, document, loaders));
}
