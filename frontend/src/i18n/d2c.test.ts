import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Every string D2c adds (designPage.* is covered by the design page's own test). */
const D2C_KEYS = [
    'calendar.prevMonth', 'calendar.nextMonth', 'calendar.loadFailed', 'calendar.itemCount',
    'common.retry', 'common.confirm', 'common.mediaViewer',
    'about.madeWithLove', 'media.typeTabs', 'profileImages.kinds',
    'blogs.addFavorite', 'blogs.removeFavorite',
    'search.title', 'search.filters', 'search.searchFailed', 'search.removeFilter',
    'settings.sections', 'settings.saveFailed',
    'messageList.messageActions',
] as const;

/** Keys D2c removed: nothing may bring them back. */
const REMOVED_KEYS = ['blogs.tapOutsideToClose', 'search.building'] as const;

type Tree = Record<string, Record<string, unknown>>;

describe('D2c strings', () => {
    it.each(Object.entries(locales))('%s has every D2c key as a non-empty string', (_code, data) => {
        const tree = data as unknown as Tree;
        for (const dotted of D2C_KEYS) {
            const [section, key] = dotted.split('.');
            const value = tree[section]?.[key];
            expect(typeof value, dotted).toBe('string');
            expect((value as string).trim().length, dotted).toBeGreaterThan(0);
        }
    });

    it.each(Object.entries(locales))('%s keeps the {{name}} placeholder in the favourite labels', (_code, data) => {
        const blogs = (data as unknown as Record<string, Record<string, string>>).blogs;
        expect(blogs.addFavorite).toContain('{{name}}');
        expect(blogs.removeFavorite).toContain('{{name}}');
    });

    it.each(Object.entries(locales))('%s keeps the placeholders in the counted and named D2c labels', (_code, data) => {
        const tree = data as unknown as Record<string, Record<string, string>>;
        expect(tree.calendar.itemCount).toContain('{{count}}');
        expect(tree.search.removeFilter).toContain('{{name}}');
    });

    it.each(Object.entries(locales))('%s no longer has the removed keys', (_code, data) => {
        const tree = data as unknown as Tree;
        for (const dotted of REMOVED_KEYS) {
            const [section, key] = dotted.split('.');
            expect(tree[section]?.[key], dotted).toBeUndefined();
        }
    });
});
