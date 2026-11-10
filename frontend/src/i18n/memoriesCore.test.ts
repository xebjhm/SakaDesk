import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';
import { NICKNAME_MASK } from '../features/memories/shared/nicknameMask';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Every Memories core-wave string (C7; every later core task appends its keys). */
export const MEMORIES_CORE_KEYS: string[] = [
    'memories.common.back', 'memories.common.retry', 'memories.common.loadError', 'memories.common.jumpToChat',
    'memories.common.all', 'memories.common.nicknameMasked',
    'memories.onThisDay.title', 'memories.album.title', 'memories.memoir.title', 'memories.favorites.title',
    // C8: On This Day and the day view
    'memories.onThisDay.more', 'memories.onThisDay.noMessages', 'memories.onThisDay.empty', 'memories.onThisDay.pickDate',
    'memories.onThisDay.prevDay', 'memories.onThisDay.nextDay', 'memories.onThisDay.olderYear', 'memories.onThisDay.newerYear',
    'memories.day.count', 'memories.day.otherGroups', 'memories.day.modeMerged', 'memories.day.modeLanes', 'memories.day.expand',
    // C9: the album
    'memories.album.filterAll', 'memories.album.filterPhotos', 'memories.album.filterVideos', 'memories.album.filterFavorites',
    'memories.album.burst', 'memories.album.monthLabel', 'memories.album.ribbonLabel', 'memories.album.ribbon', 'memories.album.empty',
];

/** Core keys with an English plural (`<key>_other` in en.json only, the repo's pattern). */
export const MEMORIES_CORE_EN_PLURALS: string[] = ['memories.onThisDay.more', 'memories.day.count', 'memories.album.burst'];

/** Recursive dotted lookup (any depth). */
const lookup = (data: unknown, dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], data);

describe('memories core strings', () => {
    it.each(Object.entries(locales))('%s has every core key as a non-empty string', (_code, data) => {
        for (const dotted of MEMORIES_CORE_KEYS) {
            const value = lookup(data, dotted);
            expect(typeof value, dotted).toBe('string');
            expect(String(value).trim(), dotted).not.toBe('');
        }
    });

    it('English has the plural form of every counted core key', () => {
        for (const dotted of MEMORIES_CORE_EN_PLURALS) expect(lookup(en, `${dotted}_other`), dotted).toBeTruthy();
    });

    it('lists every key once', () => {
        expect(new Set(MEMORIES_CORE_KEYS).size).toBe(MEMORIES_CORE_KEYS.length);
    });

    it.each(Object.entries(locales))('%s masks the nickname exactly as the share export does', (_code, data) => {
        expect(`『${String(lookup(data, 'memories.common.nicknameMasked'))}』`).toBe(NICKNAME_MASK);
    });

    it('uses the Japanese reference copy', () => {
        expect(lookup(ja, 'memories.common.back')).toBe('戻る');
        expect(lookup(ja, 'memories.common.retry')).toBe('もう一度');
        expect(lookup(ja, 'memories.common.loadError')).toBe('読み込めませんでした');
        expect(lookup(ja, 'memories.common.jumpToChat')).toBe('トークで見る');
        expect(lookup(ja, 'memories.common.all')).toBe('全員');
        expect(lookup(ja, 'memories.common.nicknameMasked')).toBe('＊＊＊');
        expect(lookup(ja, 'memories.onThisDay.title')).toBe('あの年の今日');
        expect(lookup(ja, 'memories.onThisDay.more')).toBe('ほか {{count}} 件');
        expect(lookup(ja, 'memories.onThisDay.noMessages')).toBe('この日はメッセージがありません');
        expect(lookup(ja, 'memories.onThisDay.empty')).toBe('この日の思い出は、まだここにありません。別の日を開いてみてください。');
        expect(lookup(ja, 'memories.onThisDay.pickDate')).toBe('日付をえらぶ');
        expect(lookup(ja, 'memories.onThisDay.prevDay')).toBe('前の日');
        expect(lookup(ja, 'memories.onThisDay.nextDay')).toBe('次の日');
        expect(lookup(ja, 'memories.day.count')).toBe('{{count}} 件のメッセージ');
        expect(lookup(ja, 'memories.day.otherGroups')).toBe('ほかのグループも含める');
        expect(lookup(ja, 'memories.day.modeMerged')).toBe('時系列');
        expect(lookup(ja, 'memories.day.modeLanes')).toBe('メンバー別');
        expect(lookup(ja, 'memories.day.expand')).toBe('ひらく');
        expect(lookup(ja, 'memories.album.title')).toBe('アルバム');
        expect(lookup(ja, 'memories.album.filterAll')).toBe('すべて');
        expect(lookup(ja, 'memories.album.filterPhotos')).toBe('写真');
        expect(lookup(ja, 'memories.album.filterVideos')).toBe('動画');
        expect(lookup(ja, 'memories.album.filterFavorites')).toBe('お気に入り');
        expect(lookup(ja, 'memories.album.burst')).toBe('{{count}} 枚');
        expect(lookup(ja, 'memories.album.monthLabel')).toBe('{{year}}年{{month}}月');
        expect(lookup(ja, 'memories.album.ribbonLabel')).toBe('{{year}}年{{month}}月へ');
        expect(lookup(ja, 'memories.album.empty')).toBe('ここに並べる写真は、まだありません。');
        expect(lookup(zhTW, 'memories.onThisDay.title')).toBe('那年今日');
        expect(lookup(zhTW, 'memories.onThisDay.noMessages')).toBe('這天沒有訊息');
        expect(lookup(zhTW, 'memories.day.otherGroups')).toBe('包含其他團體');
        expect(lookup(zhTW, 'memories.day.modeMerged')).toBe('合流');
        expect(lookup(zhTW, 'memories.day.modeLanes')).toBe('泳道');
    });
});
