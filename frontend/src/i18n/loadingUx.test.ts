import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Every loading-UX wave string (L1; every later loading task appends its keys). */
export const LOADING_UX_KEYS: string[] = [
    // L1: the shared loading primitives and the design page section
    'loading.label', 'loading.slow', 'loading.verySlow', 'loading.timeout', 'loading.timeoutHint',
    'loading.error', 'loading.retry', 'loading.cancel',
    'designPage.loading', 'designPage.playWait',
    // L6: login stays cancellable while connecting; sync scanning state
    'login.waitingSlow', 'login.waitingVerySlow', 'login.finishing', 'sync.preparing', 'sync.preparingVerySlow',
    'login.cancelling',
    // L5: the chat timeline while a room loads, and bubble photos
    'messageList.loadingSlow', 'messageList.loadingVerySlow', 'messageList.loadFailed', 'messageList.loadFailedHint',
    'messageList.loadTimeout', 'messageList.loadTimeoutHint', 'media.photoLoading',
];

/** Recursive dotted lookup (any depth). */
const lookup = (data: unknown, dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], data);

describe('loading UX strings', () => {
    it.each(Object.entries(locales))('%s has every loading key as a non-empty string', (_code, data) => {
        for (const dotted of LOADING_UX_KEYS) {
            const value = lookup(data, dotted);
            expect(typeof value, dotted).toBe('string');
            expect(String(value).trim(), dotted).not.toBe('');
        }
    });

    it('lists every key once', () => {
        expect(new Set(LOADING_UX_KEYS).size).toBe(LOADING_UX_KEYS.length);
    });

    it.each(Object.entries(locales))('%s keeps timeout copy apart from error copy', (_code, data) => {
        expect(lookup(data, 'loading.timeout')).not.toBe(lookup(data, 'loading.error'));
        expect(lookup(data, 'loading.verySlow')).not.toBe(lookup(data, 'loading.slow'));
        expect(lookup(data, 'messageList.loadTimeout')).not.toBe(lookup(data, 'messageList.loadFailed'));
        expect(lookup(data, 'messageList.loadTimeoutHint')).not.toBe(lookup(data, 'messageList.loadFailedHint'));
    });

    it('uses the Japanese reference copy', () => {
        const expected: Record<string, string> = {
            'loading.label': '読み込み中…',
            'loading.slow': 'まだ読み込んでいます…',
            'loading.verySlow': 'いつもより時間がかかっています。もう少しお待ちください。',
            'loading.timeout': '時間がかかりすぎています',
            'loading.timeoutHint': '処理はまだ続いているかもしれません。少し待ってからもう一度お試しください。',
            'loading.error': '読み込めませんでした',
            'loading.retry': 'もう一度',
            'loading.cancel': 'キャンセル',
            'designPage.loading': '読み込み表示',
            'designPage.playWait': '待ち時間を再生',
            'login.waitingSlow': 'ログイン画面を開いています…',
            'login.waitingVerySlow': '開いたブラウザのウィンドウでログインを完了してください。いつでもキャンセルできます。',
            'login.finishing': 'まもなく完了します…',
            'login.cancelling': 'キャンセルしています…',
            'sync.preparing': '同期の準備中…',
            'sync.preparingVerySlow': '新しいメッセージを確認しています。メッセージが多いと少し時間がかかります。',
            'messageList.loadingSlow': 'まだメッセージを読み込んでいます…',
            'messageList.loadingVerySlow': 'メッセージの多いトークは、開くまで少し時間がかかります。',
            'messageList.loadFailed': 'メッセージを読み込めませんでした',
            'messageList.loadFailedHint': '保存したデータはそのままです。もう一度お試しください。',
            'messageList.loadTimeout': '読み込みに時間がかかりすぎています',
            'messageList.loadTimeoutHint': 'アプリがまだ処理中かもしれません。少し待ってからもう一度お試しください。',
            'media.photoLoading': '写真を読み込み中…',
        };
        for (const [key, text] of Object.entries(expected)) expect(lookup(ja, key), key).toBe(text);
    });
});
