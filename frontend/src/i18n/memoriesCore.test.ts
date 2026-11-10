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
    // C10: the favorites cork board and the film strip
    'memories.favorites.all', 'memories.favorites.voice', 'memories.favorites.empty', 'memories.favorites.play',
    'memories.filmStrip.older', 'memories.filmStrip.newer', 'memories.filmStrip.title',
    // C11: the member memoir and the photocard binder
    'memories.memoir.tabBinder', 'memories.memoir.tabTimeline', 'memories.memoir.progress', 'memories.memoir.chipDays',
    'memories.memoir.chipNames', 'memories.memoir.chipVoice', 'memories.memoir.chipVoiceMinutes',
    'memories.memoir.chipVoiceHours', 'memories.shelves.first.title', 'memories.shelves.first.subtitle',
    'memories.shelves.anniversary.title', 'memories.shelves.anniversary.subtitle', 'memories.shelves.numbers.title',
    'memories.shelves.numbers.subtitle', 'memories.shelves.special.title', 'memories.shelves.special.subtitle',
    'memories.shelves.records.title', 'memories.shelves.records.subtitle', 'memories.shelves.moments.title',
    'memories.shelves.moments.subtitle', 'memories.shelves.you.title', 'memories.shelves.you.subtitle',
    'memories.shelves.change.title', 'memories.shelves.change.subtitle', 'memories.shelves.graduation.title',
    'memories.shelves.graduation.subtitle', 'memories.cards.firstMessage', 'memories.cards.firstPicture',
    'memories.cards.firstPictureCondition', 'memories.cards.firstVideo', 'memories.cards.firstVoice',
    'memories.cards.firstNickname', 'memories.cards.annivDays', 'memories.cards.annivYears', 'memories.cards.countMessages',
    'memories.cards.countPictures', 'memories.cards.voiceHour', 'memories.cards.nicknames100', 'memories.cards.newyear',
    'memories.cards.valentine', 'memories.cards.christmas', 'memories.cards.birthday', 'memories.cards.subAnniversary',
    'memories.cards.longest', 'memories.cards.busiestDay', 'memories.cards.nicknameDay', 'memories.cards.longestVoice',
    'memories.cards.greetingPair', 'memories.cards.streak', 'memories.cards.midnight', 'memories.cards.synchro',
    'memories.cards.oyasumiFirst', 'memories.cards.oyasumi100', 'memories.cards.daisukiFirst', 'memories.cards.daisuki100',
    'memories.cards.letterFirst', 'memories.cards.letters', 'memories.cards.avatarChange', 'memories.cards.avatarDays',
    'memories.cards.lastMessage', 'memories.cards.stack', 'memories.cards.notYet', 'memories.cardDetail.lastMessage',
    'memories.cardDetail.forever', 'memories.cardDetail.oldLast', 'memories.cardDetail.newFirst',
    'memories.cardDetail.oldAvatar', 'memories.cardDetail.newAvatar',
];

/** Core keys with an English plural (`<key>_other` in en.json only, the repo's pattern). */
export const MEMORIES_CORE_EN_PLURALS: string[] = [
    'memories.onThisDay.more', 'memories.day.count', 'memories.album.burst', 'memories.cards.letters', 'memories.memoir.chipNames',
];

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
        expect(lookup(ja, 'memories.favorites.title')).toBe('お気に入り');
        expect(lookup(ja, 'memories.favorites.all')).toBe('すべてのお気に入り');
        expect(lookup(ja, 'memories.favorites.voice')).toBe('ボイス');
        expect(lookup(ja, 'memories.favorites.empty')).toBe('★をつけたメッセージが、ここに飾られます。');
        expect(lookup(ja, 'memories.filmStrip.older')).toBe('前のメッセージ');
        expect(lookup(ja, 'memories.filmStrip.newer')).toBe('次のメッセージ');
        expect(lookup(ja, 'memories.filmStrip.title')).toBe('この日のつづき');
        expect(lookup(ja, 'memories.memoir.tabBinder')).toBe('生写真帳');
        expect(lookup(ja, 'memories.memoir.tabTimeline')).toBe('タイムライン');
        expect(lookup(ja, 'memories.memoir.progress')).toBe('{{earned}} / {{total}} 枚');
        expect(lookup(ja, 'memories.memoir.chipDays')).toBe('メンバーシップ {{days}} 日');
        expect(lookup(ja, 'memories.memoir.chipNames')).toBe('名前を呼んでくれた {{count}} 回');
        expect(lookup(ja, 'memories.memoir.chipVoice')).toBe('声 {{h}}時間{{m}}分');
        expect(lookup(ja, 'memories.memoir.chipVoiceMinutes')).toBe('声 {{m}}分');
        expect(lookup(ja, 'memories.memoir.chipVoiceHours')).toBe('声 {{h}}時間');
        expect(lookup(ja, 'memories.shelves.first.title')).toBe('初めて');
        expect(lookup(ja, 'memories.shelves.anniversary.title')).toBe('記念日');
        expect(lookup(ja, 'memories.shelves.numbers.title')).toBe('数字');
        expect(lookup(ja, 'memories.shelves.special.title')).toBe('特別な日');
        expect(lookup(ja, 'memories.shelves.records.title')).toBe('記録');
        expect(lookup(ja, 'memories.shelves.moments.title')).toBe('瞬間');
        expect(lookup(ja, 'memories.shelves.you.title')).toBe('あなた');
        expect(lookup(ja, 'memories.shelves.change.title')).toBe('変化');
        expect(lookup(ja, 'memories.shelves.graduation.title')).toBe('卒業');
        expect(lookup(ja, 'memories.cards.firstMessage')).toBe('最初のメッセージ');
        expect(lookup(ja, 'memories.cards.firstPicture')).toBe('最初の写真');
        expect(lookup(ja, 'memories.cards.firstPictureCondition')).toBe('最初の写真が届いたら');
        expect(lookup(ja, 'memories.cards.firstVideo')).toBe('最初の動画');
        expect(lookup(ja, 'memories.cards.firstVoice')).toBe('最初のボイス');
        expect(lookup(ja, 'memories.cards.firstNickname')).toBe('はじめて名前を呼んでくれた日');
        expect(lookup(ja, 'memories.cards.annivDays')).toBe('{{days}}日目');
        expect(lookup(ja, 'memories.cards.annivYears')).toBe('{{years}}年目の記念日');
        expect(lookup(ja, 'memories.cards.countMessages')).toBe('{{count}}通目');
        expect(lookup(ja, 'memories.cards.countPictures')).toBe('{{count}}枚目の写真');
        expect(lookup(ja, 'memories.cards.voiceHour')).toBe('声を、1時間');
        expect(lookup(ja, 'memories.cards.nicknames100')).toBe('100回目の名前');
        expect(lookup(ja, 'memories.cards.newyear')).toBe('元旦');
        expect(lookup(ja, 'memories.cards.valentine')).toBe('バレンタイン');
        expect(lookup(ja, 'memories.cards.christmas')).toBe('クリスマス');
        expect(lookup(ja, 'memories.cards.birthday')).toBe('お誕生日');
        expect(lookup(ja, 'memories.cards.subAnniversary')).toBe('あなたの記念日');
        expect(lookup(ja, 'memories.cards.longest')).toBe('いちばん長いメッセージ');
        expect(lookup(ja, 'memories.cards.busiestDay')).toBe('いちばんにぎやかな日');
        expect(lookup(ja, 'memories.cards.nicknameDay')).toBe('いちばん名前を呼んでくれた日');
        expect(lookup(ja, 'memories.cards.longestVoice')).toBe('いちばん長いボイス');
        expect(lookup(ja, 'memories.cards.greetingPair')).toBe('いちばん早いおはようと、いちばん遅いおやすみ');
        expect(lookup(ja, 'memories.cards.streak')).toBe('{{days}}日つづけて');
        expect(lookup(ja, 'memories.cards.midnight')).toBe('日付が変わった瞬間');
        expect(lookup(ja, 'memories.cards.synchro')).toBe('シンクロ');
        expect(lookup(ja, 'memories.cards.oyasumiFirst')).toBe('最初のおやすみ');
        expect(lookup(ja, 'memories.cards.oyasumi100')).toBe('100回目のおやすみ');
        expect(lookup(ja, 'memories.cards.daisukiFirst')).toBe('最初の大好き');
        expect(lookup(ja, 'memories.cards.daisuki100')).toBe('100回目の大好き');
        expect(lookup(ja, 'memories.cards.letterFirst')).toBe('はじめて送った手紙');
        expect(lookup(ja, 'memories.cards.letters')).toBe('{{count}}通の手紙');
        expect(lookup(ja, 'memories.cards.avatarChange')).toBe('新しい写真');
        expect(lookup(ja, 'memories.cards.avatarDays')).toBe('この写真と、{{days}} 日');
        expect(lookup(ja, 'memories.cards.lastMessage')).toBe('最後の一通');
        expect(lookup(ja, 'memories.cards.stack')).toBe('×{{count}}');
        expect(lookup(ja, 'memories.cards.notYet')).toBe('まだ');
        expect(lookup(ja, 'memories.cardDetail.lastMessage')).toBe('最後のメッセージ');
        expect(lookup(ja, 'memories.cardDetail.forever')).toBe('ずっと、ここに。');
        expect(lookup(zhTW, 'memories.onThisDay.title')).toBe('那年今日');
        expect(lookup(zhTW, 'memories.onThisDay.noMessages')).toBe('這天沒有訊息');
        expect(lookup(zhTW, 'memories.day.otherGroups')).toBe('包含其他團體');
        expect(lookup(zhTW, 'memories.day.modeMerged')).toBe('合流');
        expect(lookup(zhTW, 'memories.day.modeLanes')).toBe('泳道');
    });
});
