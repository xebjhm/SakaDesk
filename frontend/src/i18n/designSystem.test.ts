import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;
type Tree = Record<string, Record<string, string>>;

describe('design-system strings', () => {
    it.each(Object.entries(locales))('%s has the date and badge keys', (_code, data) => {
        const tree = data as unknown as Tree;
        expect(tree.date?.today).toBeTruthy();
        expect(tree.date?.yesterday).toBeTruthy();
        expect(tree.common.unreadCount).toContain('{{count}}');
    });
});
