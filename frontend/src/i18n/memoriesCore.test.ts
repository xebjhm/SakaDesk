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
    'memories.cards.greetingPair', 'memories.cards.midnight', 'memories.cards.synchro',
    'memories.cards.oyasumiFirst', 'memories.cards.oyasumi100', 'memories.cards.daisukiFirst', 'memories.cards.daisuki100',
    'memories.cards.letterFirst', 'memories.cards.letters', 'memories.cards.avatarChange', 'memories.cards.avatarDays',
    'memories.cards.lastMessage', 'memories.cards.stack', 'memories.cards.notYet', 'memories.cardDetail.lastMessage',
    'memories.cardDetail.forever', 'memories.cardDetail.oldLast', 'memories.cardDetail.newFirst',
    'memories.cardDetail.oldAvatar', 'memories.cardDetail.newAvatar',
    // C11 fix wave 1: a condition for every card, the detail's day label
    'memories.cards.firstMessageCondition', 'memories.cards.firstVideoCondition', 'memories.cards.firstVoiceCondition',
    'memories.cards.firstNicknameCondition', 'memories.cards.annivDaysCondition', 'memories.cards.annivYearsCondition',
    'memories.cards.countMessagesCondition', 'memories.cards.countPicturesCondition', 'memories.cards.voiceHourCondition',
    'memories.cards.nicknames100Condition', 'memories.cards.newyearCondition', 'memories.cards.valentineCondition',
    'memories.cards.christmasCondition', 'memories.cards.birthdayCondition', 'memories.cards.subAnniversaryCondition',
    // r4: the subscription start day (加入紀念日)
    'memories.cards.joinDay', 'memories.cards.joinDayCondition',
    'memories.cards.longestCondition', 'memories.cards.busiestDayCondition', 'memories.cards.nicknameDayCondition',
    'memories.cards.longestVoiceCondition', 'memories.cards.greetingPairCondition',
    'memories.cards.midnightCondition', 'memories.cards.synchroCondition', 'memories.cards.oyasumiFirstCondition',
    'memories.cards.oyasumi100Condition', 'memories.cards.daisukiFirstCondition', 'memories.cards.daisuki100Condition',
    'memories.cards.letterFirstCondition', 'memories.cards.lettersCondition', 'memories.cards.avatarChangeCondition',
    'memories.cards.lastMessageCondition', 'memories.cardDetail.dayOf', 'memories.cardDetail.nearestDay',
    // C12: name moments and the memoir timeline
    'memories.names.title', 'memories.names.allYears', 'memories.names.back',
    'memories.timeline.count', 'memories.timeline.top', 'memories.timeline.late', 'memories.timeline.nickname',
    'memories.timeline.milestones', 'memories.timeline.rail', 'memories.timeline.older', 'memories.timeline.newer',
    'memories.names.empty', 'memories.timeline.empty',
    // C13: the hub board
    'memories.home.title', 'memories.home.yearsAgo', 'memories.home.thisWeek', 'memories.home.firstMessage',
    'memories.home.open', 'memories.home.album', 'memories.home.memoir', 'memories.home.favorites',
    'memories.home.countAlbum', 'memories.home.countMembers', 'memories.home.countFavorites',
    'memories.home.birthdayIn', 'memories.home.birthdayToday', 'memories.home.anniversaryIn',
    'memories.home.anniversaryToday',
];

/** Core keys with an English plural (`<key>_other` in en.json only, the repo's pattern). */
export const MEMORIES_CORE_EN_PLURALS: string[] = [
    'memories.onThisDay.more', 'memories.day.count', 'memories.album.burst', 'memories.cards.letters', 'memories.memoir.chipNames',
    'memories.timeline.count',
    'memories.home.yearsAgo', 'memories.home.thisWeek', 'memories.home.countAlbum', 'memories.home.countMembers',
    'memories.home.countFavorites', 'memories.home.birthdayIn', 'memories.home.anniversaryIn',
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

    it.each(Object.entries(locales))('%s keeps every binder condition to one number and never a 0', (_code, data) => {
        const cards = lookup(data, 'memories.cards') as Record<string, string>;
        const conditions = Object.entries(cards).filter(([key]) => key.endsWith('Condition'));
        expect(conditions.length).toBeGreaterThan(30);
        for (const [key, text] of conditions) {
            expect(text, key).not.toMatch(/(?<![\d,.])0(?![\d,.])/);
            // a digit run (1,000 / 1.5) or an interpolation placeholder each count as one number
            const numbers = text.match(/\{\{[^}]+\}\}|\d+(?:[.,]\d+)*/g) ?? [];
            expect(numbers.length, key).toBeLessThanOrEqual(1);
        }
    });

    it.each(Object.entries(locales))('%s keeps every hub line to one number', (_code, data) => {
        const home = lookup(data, 'memories.home') as Record<string, string>;
        for (const [key, text] of Object.entries(home)) {
            const numbers = text.match(/\{\{(?!name)[^}]+\}\}|\d+(?:[.,]\d+)*/g) ?? [];
            // 12月1日 in the recap card's closed line is a date, not a count
            if (key !== 'opensOn') expect(numbers.length, key).toBeLessThanOrEqual(1);
        }
    });

    it('uses the hub reference copy (countdown lines carry one number each)', () => {
        const expected: Record<string, string> = {
            title: '思い出', yearsAgo: '{{count}}年前の今日', thisWeek: '{{count}}年前の、この週', firstMessage: 'はじめのころの一通',
            open: 'ひらく', album: 'アルバム', memoir: 'メンバーの思い出', favorites: 'お気に入り',
            countAlbum: '{{count, number}} 枚', countMembers: '{{count, number}} 人', countFavorites: '{{count, number}} 件',
            birthdayIn: '{{name}}の誕生日まで、あと {{count, number}} 日', birthdayToday: '今日は{{name}}の誕生日',
            anniversaryIn: '{{name}}とのメンバーシップ記念日まで、あと {{count, number}} 日',
            anniversaryToday: '今日はメンバーシップ {{years}} 年目の記念日', recapCard: '一年の振り返り',
        };
        for (const [key, text] of Object.entries(expected)) expect(lookup(ja, `memories.home.${key}`), key).toBe(text);
    });

    it("never calls the hub's early-days moment the very first message (it skips promo)", () => {
        expect(lookup(en, 'memories.home.firstMessage')).toBe('From the early days');
        for (const [lang, data] of Object.entries(locales)) {
            expect(lookup(data, 'memories.home.firstMessage'), lang).not.toBe(lookup(data, 'memories.cards.firstMessage'));
        }
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
        expect(lookup(ja, 'memories.memoir.progress')).toBe('{{earned, number}} / {{total, number}} 枚');
        expect(lookup(ja, 'memories.memoir.chipDays')).toBe('メンバーシップ {{days, number}} 日');
        expect(lookup(ja, 'memories.memoir.chipNames')).toBe('名前を呼んでくれた {{count, number}} 回');
        expect(lookup(ja, 'memories.memoir.chipVoice')).toBe('ボイス合計 {{h}}時間{{m}}分');
        expect(lookup(ja, 'memories.memoir.chipVoiceMinutes')).toBe('ボイス合計 {{m}}分');
        expect(lookup(ja, 'memories.memoir.chipVoiceHours')).toBe('ボイス合計 {{h}}時間');
        expect(lookup(ja, 'memories.cards.voiceHour')).toBe('ボイス累計 1 時間');
        expect(lookup(zhTW, 'memories.cards.voiceHour')).toBe('語音累計 1 小時');
        expect(lookup(zhTW, 'memories.memoir.chipVoice')).toBe('語音共 {{h}} 小時 {{m}} 分');
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
        expect(lookup(ja, 'memories.cards.annivDays')).toBe('{{days, number}}日目');
        expect(lookup(ja, 'memories.cards.annivYears')).toBe('{{years, number}}年目の記念日');
        expect(lookup(ja, 'memories.cards.countMessages')).toBe('{{count, number}}通目');
        expect(lookup(ja, 'memories.cards.countPictures')).toBe('{{count, number}}枚目の写真');
        expect(lookup(ja, 'memories.cards.voiceHour')).toBe('ボイス累計 1 時間');
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
        expect(lookup(ja, 'memories.cards.midnight')).toBe('日付が変わった瞬間');
        expect(lookup(ja, 'memories.cards.synchro')).toBe('シンクロ');
        expect(lookup(ja, 'memories.cards.oyasumiFirst')).toBe('最初のおやすみ');
        expect(lookup(ja, 'memories.cards.oyasumi100')).toBe('100回目のおやすみ');
        expect(lookup(ja, 'memories.cards.daisukiFirst')).toBe('最初の大好き');
        expect(lookup(ja, 'memories.cards.daisuki100')).toBe('100回目の大好き');
        expect(lookup(ja, 'memories.cards.letterFirst')).toBe('はじめて送った手紙');
        expect(lookup(ja, 'memories.cards.letters')).toBe('{{count, number}}通の手紙');
        expect(lookup(ja, 'memories.cards.avatarChange')).toBe('新しい写真');
        expect(lookup(ja, 'memories.cards.avatarDays')).toBe('この写真と、{{days, number}} 日');
        expect(lookup(ja, 'memories.cards.lastMessage')).toBe('最後の一通');
        expect(lookup(ja, 'memories.cards.stack')).toBe('×{{count, number}}');
        expect(lookup(ja, 'memories.cards.notYet')).toBe('まだ');
        expect(lookup(ja, 'memories.cardDetail.lastMessage')).toBe('最後のメッセージ');
        expect(lookup(ja, 'memories.cardDetail.forever')).toBe('ずっと、ここに。');
        expect(lookup(ja, 'memories.cards.firstMessageCondition')).toBe('最初のメッセージが届いたら');
        expect(lookup(ja, 'memories.cards.firstVideoCondition')).toBe('最初の動画が届いたら');
        expect(lookup(ja, 'memories.cards.firstVoiceCondition')).toBe('最初のボイスが届いたら');
        expect(lookup(ja, 'memories.cards.firstNicknameCondition')).toBe('はじめて名前を呼んでくれたら');
        expect(lookup(ja, 'memories.cards.annivDaysCondition')).toBe('メンバーシップ {{days, number}} 日目に');
        expect(lookup(ja, 'memories.cards.annivYearsCondition')).toBe('メンバーシップ {{years, number}} 年目の記念日に');
        expect(lookup(ja, 'memories.cards.countMessagesCondition')).toBe('{{count, number}}通目が届いたら');
        expect(lookup(ja, 'memories.cards.countPicturesCondition')).toBe('{{count, number}}枚目の写真が届いたら');
        expect(lookup(ja, 'memories.cards.voiceHourCondition')).toBe('ボイスが累計1時間になったら');
        expect(lookup(ja, 'memories.cards.nicknames100Condition')).toBe('名前を呼んでくれたのが100回になったら');
        expect(lookup(ja, 'memories.cards.newyearCondition')).toBe('新しい年の、最初の一通');
        expect(lookup(ja, 'memories.cards.valentineCondition')).toBe('バレンタインに届いたメッセージ');
        expect(lookup(ja, 'memories.cards.christmasCondition')).toBe('クリスマスに届いたメッセージ');
        expect(lookup(ja, 'memories.cards.birthdayCondition')).toBe('彼女のお誕生日に届いたメッセージ');
        expect(lookup(ja, 'memories.cards.subAnniversaryCondition')).toBe('あなたのメンバーシップ記念日に届いたメッセージ');
        expect(lookup(ja, 'memories.cards.joinDay')).toBe('加入記念日');
        expect(lookup(ja, 'memories.cards.longestCondition')).toBe('いちばん長く綴られたメッセージ');
        expect(lookup(ja, 'memories.cards.busiestDayCondition')).toBe('メッセージがいちばん多かった日');
        expect(lookup(ja, 'memories.cards.nicknameDayCondition')).toBe('名前をいちばん多く呼んでくれた日');
        expect(lookup(ja, 'memories.cards.longestVoiceCondition')).toBe('いちばん長かったボイス');
        expect(lookup(ja, 'memories.cards.greetingPairCondition')).toBe('いちばん早い時刻のおはようと、いちばん遅い時刻のおやすみ');
        expect(lookup(ja, 'memories.cards.midnightCondition')).toBe('日付が変わってすぐに届いたメッセージ');
        expect(lookup(ja, 'memories.cards.synchroCondition')).toBe('別々の日に、同じ時刻のメッセージ');
        expect(lookup(ja, 'memories.cards.oyasumiFirstCondition')).toBe('最初の「おやすみ」が届いたら');
        expect(lookup(ja, 'memories.cards.oyasumi100Condition')).toBe('「おやすみ」が100回届いたら');
        expect(lookup(ja, 'memories.cards.daisukiFirstCondition')).toBe('最初の「大好き」が届いたら');
        expect(lookup(ja, 'memories.cards.daisuki100Condition')).toBe('「大好き」が100回届いたら');
        expect(lookup(ja, 'memories.cards.letterFirstCondition')).toBe('はじめて手紙を送ったら');
        expect(lookup(ja, 'memories.cards.lettersCondition')).toBe('手紙を{{count, number}}通送ったら');
        expect(lookup(ja, 'memories.cards.avatarChangeCondition')).toBe('写真が変わった日');
        expect(lookup(ja, 'memories.cards.lastMessageCondition')).toBe('卒業までの、最後の一通');
        expect(lookup(ja, 'memories.cardDetail.dayOf')).toBe('{{date}} のメッセージ');
        expect(lookup(ja, 'memories.cardDetail.nearestDay')).toBe('いちばん近い日のメッセージ（{{date}}）');
        expect(lookup(ja, 'memories.names.title')).toBe('名前を呼ばれた瞬間');
        expect(lookup(ja, 'memories.names.allYears')).toBe('すべて');
        expect(lookup(ja, 'memories.names.back')).toBe('生写真帳へ');
        expect(lookup(ja, 'memories.timeline.count')).toBe('{{count}} 件');
        expect(lookup(ja, 'memories.timeline.top')).toBe('この月の一通');
        expect(lookup(ja, 'memories.timeline.late')).toBe('夜ふけの一通');
        expect(lookup(ja, 'memories.timeline.nickname')).toBe('名前を呼んでくれた一通');
        expect(lookup(ja, 'memories.timeline.milestones')).toBe('この月のできごと');
        expect(lookup(ja, 'memories.timeline.rail')).toBe('月をえらぶ');
        expect(lookup(ja, 'memories.timeline.older')).toBe('前の月');
        expect(lookup(ja, 'memories.timeline.newer')).toBe('次の月');
        expect(lookup(ja, 'memories.names.empty')).toBe('ここには、名前を呼んでくれた瞬間が並びます');
        expect(lookup(ja, 'memories.timeline.empty')).toBe('ここには、月ごとの思い出が並びます');
        expect(lookup(zhTW, 'memories.onThisDay.title')).toBe('那年今日');
        expect(lookup(zhTW, 'memories.onThisDay.noMessages')).toBe('這天沒有訊息');
        expect(lookup(zhTW, 'memories.day.otherGroups')).toBe('包含其他團體');
        expect(lookup(zhTW, 'memories.day.modeMerged')).toBe('依時間');
        expect(lookup(zhTW, 'memories.day.modeLanes')).toBe('依成員');
    });
});

describe('Memories anniversary wording per locale', () => {
    const WANT: Record<keyof typeof locales, Record<string, string>> = {
        ja: {
            'memories.home.anniversaryToday': '今日はメンバーシップ {{years}} 年目の記念日',
            'memories.cards.annivYears': '{{years, number}}年目の記念日',
            'memories.cards.annivYearsCondition': 'メンバーシップ {{years, number}} 年目の記念日に',
        },
        en: {
            'memories.home.anniversaryToday': 'Today is your {{years}}-year membership anniversary',
            'memories.cards.annivYears': '{{years, number}}-year anniversary',
            'memories.cards.annivYearsCondition': 'On your {{years, number}}-year membership anniversary',
        },
        'zh-TW': {
            'memories.home.anniversaryToday': '今天是會員 {{years}} 週年紀念日',
            'memories.cards.annivYears': '{{years, number}} 週年紀念日',
            'memories.cards.annivYearsCondition': '訂閱 {{years, number}} 週年',
        },
        'zh-CN': {
            'memories.home.anniversaryToday': '今天是会员 {{years}} 周年纪念日',
            'memories.cards.annivYears': '{{years, number}} 周年纪念日',
            'memories.cards.annivYearsCondition': '订阅 {{years, number}} 周年',
        },
        yue: {
            'memories.home.anniversaryToday': '今日係會員 {{years}} 週年紀念日',
            'memories.cards.annivYears': '{{years, number}} 週年紀念日',
            'memories.cards.annivYearsCondition': '訂閱 {{years, number}} 週年',
        },
    };
    const at = (data: unknown, key: string): unknown =>
        key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], data);

    it.each(Object.entries(WANT))('%s: N年目 / N 週年 / N 周年 / N-year anniversary', (code, want) => {
        for (const [key, value] of Object.entries(want)) {
            expect(at(locales[code as keyof typeof locales], key), `${code}.${key}`).toBe(value);
        }
    });
});

describe('Memories score-picked slots make no claim about her feelings', () => {
    // The timeline's `top` and the recap's best photo are the app's highest-scored picks.
    const WANT: Record<keyof typeof locales, [string, string]> = {
        ja: ['この月の一通', '今年の、この一枚。'],
        en: ["This month's message", 'One picture from this year.'],
        'zh-TW': ['這個月的一則', '今年的這一張。'],
        'zh-CN': ['这个月的一条', '今年的这一张。'],
        yue: ['呢個月嘅一則', '今年嘅呢一張。'],
    };
    const at = (data: unknown, key: string): unknown =>
        key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], data);

    it.each(Object.entries(WANT))('%s uses the neutral copy', (code, [top, photo]) => {
        const data = locales[code as keyof typeof locales];
        expect(at(data, 'memories.timeline.top')).toBe(top);
        expect(at(data, 'recap.s05.bestPhoto')).toBe(photo);
    });
});
