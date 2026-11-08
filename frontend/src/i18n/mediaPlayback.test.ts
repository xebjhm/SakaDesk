import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Strings the media players show when playback fails (Retry reuses `common.retry`). */
const KEYS: readonly string[] = ['videoPlayer.playbackError', 'voicePlayer.playbackError', 'common.retry', 'common.loading'];

const lookup = (data: unknown, dotted: string): unknown => {
    const [section, key] = dotted.split('.');
    return (data as Record<string, Record<string, unknown>>)[section]?.[key];
};

describe('media playback strings', () => {
    it.each(Object.entries(locales))('%s has every media playback key', (_code, data) => {
        for (const dotted of KEYS) expect(lookup(data, dotted), dotted).toBeTruthy();
    });
});
