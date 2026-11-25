import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';
import { OUTPUT_DIR_ERROR_CODES } from '../shell/outputFolder';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

describe('output folder strings (security audit 2026-11-13)', () => {
    it.each(Object.entries(locales))('%s has a message for every output folder reason', (_code, locale) => {
        const errors = (locale as unknown as { settings: { outputDirError: Record<string, string> } }).settings.outputDirError;
        expect(Object.keys(errors).sort()).toEqual([...OUTPUT_DIR_ERROR_CODES].sort());
        for (const value of Object.values(errors)) expect(value.trim()).not.toBe('');
    });

    it.each(Object.entries(locales))('%s no longer asks to type or paste a path', (_code, locale) => {
        const setup = (locale as unknown as { setup: Record<string, string> }).setup;
        expect(setup.outputFolderHint).not.toMatch(/copy|コピー|複製|复制/i);
    });

    it('English wording', () => {
        expect(en.settings.outputDirError.not_picked).toBe('Choose the folder with Browse again.');
        expect(en.setup.folderRequired).toBe('Choose a folder first');
        expect(en.setup.outputFolderHint).toBe('Your messages and photos are saved here. Click Browse to choose another folder.');
    });

    it.each([
        ['en', en, 'Browse'],
        ['ja', ja, '参照'],
        ['zh-TW', zhTW, '瀏覽'],
        ['zh-CN', zhCN, '浏览'],
        ['yue', yue, '瀏覽'],
    ] as const)('%s "picker already open" text asks to close it and click Browse again', (_code, locale, browse) => {
        const errors = (locale as unknown as { settings: { outputDirError: Record<string, string> } }).settings.outputDirError;
        expect(errors.busy).toContain(browse);
    });

    it('English busy wording', () => {
        expect(en.settings.outputDirError.busy).toBe('A folder picker is already open. Close it, then click Browse again.');
    });

    it.each(Object.entries(locales))('%s explains media Verify skipped for safety', (_code, locale) => {
        const settings = (locale as unknown as { settings: Record<string, unknown> }).settings;
        expect(String(settings.verifyRejected)).toContain('{{count}}');
    });
});
