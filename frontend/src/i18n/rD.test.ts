import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Every string R-d adds (later tasks append). */
const RD_KEYS: readonly string[] = ['tos.acceptRequired', 'setup.folderRequired', 'about.archiveTitle', 'about.statMessages', 'about.statPhotos', 'about.statDays', 'celebration.firstSyncTitle', 'celebration.firstSyncBody'];

/** R-d keys with an English plural (`<key>_other` in en.json only, the repo's pattern). */
const RD_EN_PLURALS: readonly string[] = ['celebration.firstSyncBody'];

const lookup = (data: unknown, dotted: string): unknown => {
    const [section, key] = dotted.split('.');
    return (data as Record<string, Record<string, unknown>>)[section]?.[key];
};

describe('R-d strings', () => {
    it.each(Object.entries(locales))('%s has every R-d key', (_code, data) => {
        for (const dotted of RD_KEYS) expect(lookup(data, dotted), dotted).toBeTruthy();
    });

    it('English has the plural form of every counted R-d key', () => {
        for (const dotted of RD_EN_PLURALS) expect(lookup(en, `${dotted}_other`), dotted).toBeTruthy();
    });
});
