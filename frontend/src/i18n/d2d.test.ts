import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Every string D2d adds. */
const D2D_KEYS = ['common.debug', 'sync.progress'] as const;

type Tree = Record<string, Record<string, unknown>>;

describe('D2d strings', () => {
    it.each(Object.entries(locales))('%s has every D2d key as a non-empty string', (_code, data) => {
        const tree = data as unknown as Tree;
        for (const dotted of D2D_KEYS) {
            const [section, key] = dotted.split('.');
            const value = tree[section]?.[key];
            expect(typeof value, dotted).toBe('string');
            expect((value as string).trim().length, dotted).toBeGreaterThan(0);
        }
    });
});
