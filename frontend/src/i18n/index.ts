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

const STORAGE_KEY = 'sakadesk-language';

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
    const supportedCodes = Object.keys(SUPPORTED_LANGUAGES);
    const lower = navLang.toLowerCase();

    // 1) Exact locale match across ALL supported codes (case-insensitive).
    //    Must run before any prefix fallback so e.g. 'zh-TW' matches 'zh-TW'
    //    rather than being swallowed by the 'zh-CN' prefix.
    const exact = supportedCodes.find(code => code.toLowerCase() === lower);
    if (exact) return exact;

    // 2) Traditional-Chinese preference: zh-HK / zh-Hant (and their variants)
    //    should map to Traditional, not the insertion-order-first Simplified.
    if (lower.startsWith('zh')) {
        if (lower.includes('hk') || lower.includes('mo') || lower.includes('hant') || lower.includes('tw')) {
            return 'zh-TW';
        }
        // zh-CN / zh-Hans / bare zh → Simplified
        return 'zh-CN';
    }

    // 3) Prefix fallback for non-Chinese languages (e.g. 'en-US' → 'en').
    const prefix = lower.split('-')[0];
    return supportedCodes.find(code => code.split('-')[0].toLowerCase() === prefix);
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
