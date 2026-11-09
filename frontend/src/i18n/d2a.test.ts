import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Every string D2a adds (later tasks append to this list). */
const D2A_KEYS = [
    'messageList.openCalendar',
    'contentArea.comingSoon',
    'serviceRail.label',
    'featureRail.label',
    'messageList.openConversations',
    'letters.openImage',
    'letters.you',
    'letters.openImageAt',
    'sentLetters.loading',
    'sentLetters.unavailable',
    'sentLetters.letterSent',
] as const;

describe('D2a strings', () => {
    it.each(Object.entries(locales))('%s has every D2a key', (_code, data) => {
        const tree = data as unknown as Record<string, Record<string, string>>;
        for (const dotted of D2A_KEYS) {
            const [section, key] = dotted.split('.');
            expect(tree[section]?.[key], dotted).toBeTruthy();
        }
    });
});

describe('D2a removed strings', () => {
    const DEAD_KEYS = ['common.refresh', 'sentLetters.tapToClose', 'sentLetters.noGroupId', 'sentLetters.noService', 'sentLetters.fetchFailed'];
    it.each(Object.entries(locales))('%s has none of the dead keys', (_code, data) => {
        const tree = data as unknown as Record<string, Record<string, string>>;
        for (const dotted of DEAD_KEYS) {
            const [section, key] = dotted.split('.');
            expect(tree[section]?.[key], dotted).toBeUndefined();
        }
    });
});
