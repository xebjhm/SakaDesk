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

const STORAGE_KEY = 'hakodesk-language';

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

// Resolve initial language synchronously from localStorage
const savedLang = localStorage.getItem(STORAGE_KEY);
const initialLng = (savedLang && savedLang in SUPPORTED_LANGUAGES) ? savedLang : 'en';

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

// On first launch (no localStorage language), check installer preference then browser language.
// Priority: 1) localStorage (explicit user choice) → 2) installer setting → 3) browser language
if (!savedLang) {
    fetch('/api/settings')
        .then(res => res.json())
        .then(data => {
            const installerLang = data?.language;
            if (installerLang && installerLang in SUPPORTED_LANGUAGES) {
                i18n.changeLanguage(installerLang);
                localStorage.setItem(STORAGE_KEY, installerLang);
            } else {
                const match = findBrowserLanguageMatch();
                if (match) {
                    i18n.changeLanguage(match);
                    localStorage.setItem(STORAGE_KEY, match);
                }
            }
        })
        .catch(() => {
            const match = findBrowserLanguageMatch();
            if (match) {
                i18n.changeLanguage(match);
                localStorage.setItem(STORAGE_KEY, match);
            }
        });
}

export default i18n;

// Re-export for convenience
export { useTranslation } from 'react-i18next';
