import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Every string D2b adds. */
const D2B_KEYS = [
    'blogs.back',
    'blogs.postsFrom',
    'blogs.feedLoadFailed',
    'blogs.postLoadFailed',
    'blogs.loadingPost',
    'blogs.olderPost',
    'blogs.newerPost',
    'blogs.postNavigation',
] as const;

describe('D2b strings', () => {
    it.each(Object.entries(locales))('%s has every D2b key', (_code, data) => {
        const tree = data as unknown as Record<string, Record<string, string>>;
        for (const dotted of D2B_KEYS) {
            const [section, key] = dotted.split('.');
            expect(tree[section]?.[key], dotted).toBeTruthy();
        }
    });
});
