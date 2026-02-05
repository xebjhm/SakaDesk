import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation files
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';

// Supported languages with their display names
export const SUPPORTED_LANGUAGES = {
    en: { name: 'English', nativeName: 'English' },
    ja: { name: 'Japanese', nativeName: '日本語' },
    'zh-CN': { name: 'Simplified Chinese', nativeName: '简体中文' },
    'zh-TW': { name: 'Traditional Chinese', nativeName: '繁體中文' },
} as const;

export type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES;

// Resources object with all translations
const resources = {
    en: { translation: en },
    ja: { translation: ja },
    'zh-CN': { translation: zhCN },
    'zh-TW': { translation: zhTW },
};

// Initialize i18next
i18n
    // Detect user language
    .use(LanguageDetector)
    // Pass the i18n instance to react-i18next
    .use(initReactI18next)
    // Initialize i18next
    .init({
        resources,
        fallbackLng: 'en',
        debug: process.env.NODE_ENV === 'development', // Enable debug in development

        interpolation: {
            escapeValue: false, // React already escapes by default
        },

        detection: {
            // Order of language detection
            order: ['localStorage', 'navigator', 'htmlTag'],
            // Cache user language selection in localStorage
            caches: ['localStorage'],
            // Key to use in localStorage
            lookupLocalStorage: 'hakodesk-language',
        },
    });

export default i18n;

// Re-export for convenience
export { useTranslation } from 'react-i18next';
