import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import translation files
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

// Supported languages with their display names
export const SUPPORTED_LANGUAGES = {
    en: { name: 'English', nativeName: 'English' },
    ja: { name: 'Japanese', nativeName: '日本語' },
    'zh-CN': { name: 'Simplified Chinese', nativeName: '简体中文' },
    'zh-TW': { name: 'Traditional Chinese', nativeName: '繁體中文' },
    yue: { name: 'Cantonese', nativeName: '廣東話' },
} as const;

export type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES;

// Resources object with all translations
const resources = {
    en: { translation: en },
    ja: { translation: ja },
    'zh-CN': { translation: zhCN },
    'zh-TW': { translation: zhTW },
    yue: { translation: yue },
};

function findBrowserLanguageMatch(): string | undefined {
    const navLang = navigator.language;
    return Object.keys(SUPPORTED_LANGUAGES).find(
        code => navLang === code || navLang.startsWith(code.split('-')[0])
    );
}

// Initial language is resolved synchronously from the browser locale (or the
// hard default 'en') here. The persisted user choice, and — if the user has
// none — the installer/settings.json language, are applied later by App.tsx's
// single ordered post-hydrate decision (after prefs are hydrated from the
// backend app-state store; see App.tsx). This module MUST NOT also apply
// /api/settings asynchronously: doing so raced App.tsx's apply and could flip
// the language back and forth on startup (whichever fetch resolved last won).
const initialLng = findBrowserLanguageMatch() ?? 'en';

// Initialize i18next — no LanguageDetector (it caches fallback 'en' to localStorage
// before we can check the installer setting, blocking the settings fetch entirely).
i18n
    .use(initReactI18next)
    .init({
        resources,
        lng: initialLng,
        fallbackLng: 'en',
        debug: process.env.NODE_ENV === 'development',

        interpolation: {
            escapeValue: false,
        },
    });

export default i18n;

// Re-export for convenience
export { useTranslation } from 'react-i18next';
