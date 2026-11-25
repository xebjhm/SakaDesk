import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Strings of the UI-health theming plan (H). */
const KEYS: readonly string[] = ['errorBoundary.title', 'errorBoundary.body', 'errorBoundary.retry', 'errorBoundary.report'];

const lookup = (data: unknown, dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((node, k) => (node as Record<string, unknown> | undefined)?.[k], data);

describe('UI health theming strings', () => {
    it.each(Object.entries(locales))('%s has every key', (_code, data) => {
        for (const dotted of KEYS) expect(lookup(data, dotted), dotted).toBeTruthy();
    });
});
