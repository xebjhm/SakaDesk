import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

const EXPECTED = {
    en: {
        closeToTray: 'Keep running in the tray when closed',
        closeToTrayDesc: 'Closing the window keeps SakaDesk syncing in the background',
        autostart: 'Start with Windows',
        autostartDesc: 'Starts hidden in the tray when you sign in',
    },
    ja: {
        closeToTray: '閉じてもトレイで実行を続ける',
        closeToTrayDesc: 'ウィンドウを閉じてもバックグラウンドで同期を続けます',
        autostart: 'Windows の起動時に開始',
        autostartDesc: 'サインイン時にトレイで起動します',
    },
    'zh-TW': {
        closeToTray: '關閉視窗時縮到系統匣',
        closeToTrayDesc: '關閉視窗後 SakaDesk 會在背景繼續同步',
        autostart: '開機時自動啟動',
        autostartDesc: '登入 Windows 時直接在系統匣啟動',
    },
    'zh-CN': {
        closeToTray: '关闭窗口时缩到系统托盘',
        closeToTrayDesc: '关闭窗口后 SakaDesk 会在后台继续同步',
        autostart: '开机时自动启动',
        autostartDesc: '登录 Windows 时直接在系统托盘启动',
    },
    yue: {
        closeToTray: '閂視窗時縮到系統匣',
        closeToTrayDesc: '閂咗視窗之後 SakaDesk 會喺背景繼續同步',
        autostart: '開機時自動啟動',
        autostartDesc: '登入 Windows 時直接喺系統匣啟動',
    },
} as const;

describe('tray settings strings', () => {
    it.each(Object.entries(EXPECTED))('%s uses the agreed wording', (code, want) => {
        const settings = (locales[code as keyof typeof locales] as unknown as Record<string, Record<string, string>>).settings;
        for (const [key, value] of Object.entries(want)) {
            expect(settings[key], `${code}.${key}`).toBe(value);
        }
    });
});
