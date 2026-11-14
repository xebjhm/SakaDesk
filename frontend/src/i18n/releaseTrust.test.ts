import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

describe('unverified update message (security Plan E)', () => {
    it.each(Object.entries(locales))('%s explains that the update was not installed', (_code, locale) => {
        const text = (locale as unknown as { update: Record<string, string> }).update.notVerified;
        expect(text.trim()).not.toBe('');
    });

    it('English wording', () => {
        expect(en.update.notVerified).toBe('This update could not be verified, so it was not installed. Try again later.');
    });
});
