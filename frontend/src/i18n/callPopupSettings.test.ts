import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

const EXPECTED = {
    en: {
        callPopup: 'Background call popup',
        callPopupDesc: 'When SakaDesk is in the background and a member sends a voice message, it rings in a small window at the bottom right',
    },
    ja: {
        callPopup: 'バックグラウンド着信ウィンドウ',
        callPopupDesc: 'SakaDesk がバックグラウンドのときにメンバーからボイスが届くと、右下の小さなウィンドウで着信します',
    },
    'zh-TW': {
        callPopup: '背景來電小窗',
        callPopupDesc: 'SakaDesk 在背景時收到成員語音，會在右下角小窗以來電方式響起',
    },
    'zh-CN': {
        callPopup: '后台来电小窗',
        callPopupDesc: 'SakaDesk 在后台时收到成员语音，会在右下角小窗以来电方式响起',
    },
    yue: {
        callPopup: '背景來電小窗',
        callPopupDesc: 'SakaDesk 喺背景時收到成員語音，會喺右下角小窗以來電方式響起',
    },
} as const;

describe('call popup settings strings', () => {
    it.each(Object.entries(EXPECTED))('%s uses the agreed wording', (code, want) => {
        const settings = (locales[code as keyof typeof locales] as unknown as Record<string, Record<string, string>>).settings;
        for (const [key, value] of Object.entries(want)) {
            expect(settings[key], `${code}.${key}`).toBe(value);
        }
    });
});
