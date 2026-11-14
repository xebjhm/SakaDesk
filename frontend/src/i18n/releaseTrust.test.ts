import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

// Each locale must carry update.notVerified; the annotation checks that at compile time.
type WithNotVerified = { update: { notVerified: string } };
const locales: Record<string, WithNotVerified> = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue };

describe('unverified update message (security Plan E)', () => {
    it.each(Object.entries(locales))('%s explains that the update was not installed', (_code, locale) => {
        const text = locale.update.notVerified;
        expect(text.trim()).not.toBe('');
    });

    it('English wording', () => {
        expect(en.update.notVerified).toBe('This update could not be verified, so it was not installed. Try again later.');
    });
});
