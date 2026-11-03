import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

const EXPECTED = {
    en: { incoming: 'Incoming call…', ended: 'Call ended' },
    ja: { incoming: '着信中…', ended: '通話終了' },
    'zh-TW': { incoming: '來電中…', ended: '通話結束' },
    'zh-CN': { incoming: '来电中…', ended: '通话结束' },
    yue: { incoming: '來電中…', ended: '通話結束' },
} as const;

describe('incoming call strings', () => {
    it.each(Object.entries(locales))('%s has every call and setting key', (_code, data) => {
        const call = (data as unknown as Record<string, Record<string, string>>).call;
        const settings = (data as unknown as Record<string, Record<string, string>>).settings;
        for (const key of ['incoming', 'ended', 'answer', 'decline', 'hangUp']) {
            expect(call?.[key], key).toBeTruthy();
        }
        expect(settings.incomingCall).toBeTruthy();
        expect(settings.incomingCallDesc).toBeTruthy();
    });

    it.each(Object.entries(EXPECTED))('%s uses the agreed wording', (code, want) => {
        const call = (locales[code as keyof typeof locales] as unknown as Record<string, Record<string, string>>).call;
        expect(call.incoming).toBe(want.incoming);
        expect(call.ended).toBe(want.ended);
    });
});
