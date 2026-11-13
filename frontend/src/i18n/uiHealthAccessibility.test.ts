import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Strings of the UI-health accessibility plan (G); each task appends its keys. */
const KEYS: readonly string[] = [
    // Task 1
    'messageList.revealUnread.text', 'messageList.revealUnread.picture', 'messageList.revealUnread.video',
    'messageList.revealUnread.voice', 'conversationMenu.revealAll', 'conversationMenu.revealAllNone',
    // Task 2
    'search.resultsLabel',
    // Task 3
    'media.play', 'media.pause', 'media.mute', 'media.unmute', 'media.seek', 'media.volume',
    'media.timeOf', 'media.volumeValue', 'media.fullscreen', 'media.exitFullscreen',
];

const lookup = (data: unknown, dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((node, k) => (node as Record<string, unknown> | undefined)?.[k], data);

describe('UI health accessibility strings', () => {
    it.each(Object.entries(locales))('%s has every key', (_code, data) => {
        for (const dotted of KEYS) expect(lookup(data, dotted), dotted).toBeTruthy();
    });
});
