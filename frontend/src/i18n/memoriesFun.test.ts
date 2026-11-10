import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Every Memories fun-wave string (F7; every later fun task appends its keys). */
export const MEMORIES_FUN_KEYS: string[] = [
    // F7: the hub cards, the gacha card's spent line and the memoir's 24h tab
    'memories.home.radio', 'memories.home.gacha', 'memories.home.calendar',
    'memories.home.countVoices', 'memories.home.countGacha', 'memories.home.countDays', 'memories.home.gachaTomorrow',
    'memories.memoir.tabDay24',
    // F9: the voice radio
    'memories.radio.title', 'memories.radio.all', 'memories.radio.station', 'memories.radio.stationAll',
    'memories.radio.onAir', 'memories.radio.offAir', 'memories.radio.programsLabel',
    'memories.radio.programs.oyasumi', 'memories.radio.programs.oyasumiSub',
    'memories.radio.programs.ohayo', 'memories.radio.programs.ohayoSub',
    'memories.radio.programs.otsukare', 'memories.radio.programs.otsukareSub',
    'memories.radio.programs.chrono', 'memories.radio.programs.chronoSub',
    'memories.radio.programs.favorites', 'memories.radio.programs.favoritesSub',
    'memories.radio.programs.oyasumiClips', 'memories.radio.programs.oyasumiClipsSub',
    'memories.radio.trackCount', 'memories.radio.play', 'memories.radio.pause', 'memories.radio.next', 'memories.radio.prev',
    'memories.radio.sleep', 'memories.radio.sleepOff', 'memories.radio.sleepMinutes', 'memories.radio.sleepLeft',
    'memories.radio.cassette', 'memories.radio.cassetteLength', 'memories.radio.cassettes', 'memories.radio.empty',
    'memories.radio.lengthHours', 'memories.radio.lengthHoursOnly', 'memories.radio.lengthMinutes', 'memories.radio.lengthUnder',
    // F10: the gacha
    'memories.gacha.title', 'memories.gacha.turn', 'memories.gacha.left', 'memories.gacha.tomorrow', 'memories.gacha.history',
    'memories.gacha.context', 'memories.gacha.favorite', 'memories.gacha.unfavorite', 'memories.gacha.empty', 'memories.gacha.missing',
    'memories.gacha.rarity.n', 'memories.gacha.rarity.r', 'memories.gacha.rarity.sr',
    'memories.gacha.reason.midnight', 'memories.gacha.reason.birthday', 'memories.gacha.reason.subAnniversary',
    'memories.gacha.reason.lastMessage', 'memories.gacha.reason.nickname', 'memories.gacha.reason.favorite',
    'memories.gacha.reason.voice', 'memories.gacha.reason.message', 'memories.gacha.reason.photo',
    'memories.gacha.refreshFailed',
    // F11: the calendar album and the album cover choice
    'memories.calendar.title', 'memories.calendar.all', 'memories.calendar.members', 'memories.calendar.prevMonth',
    'memories.calendar.nextMonth', 'memories.calendar.pickMonth', 'memories.calendar.empty', 'memories.calendar.memberFilter',
    'memories.album.setCover', 'memories.album.resetCover', 'memories.album.coverFailed',
];

/** Fun keys with an English plural (`<key>_other` in en.json only, the repo's pattern). */
export const MEMORIES_FUN_EN_PLURALS: string[] = [
    'memories.home.countVoices', 'memories.home.countDays',
    // F9
    'memories.radio.trackCount', 'memories.radio.sleepMinutes',
    // F10
    'memories.gacha.left',
    // F11
    'memories.calendar.members',
];

/** Recursive dotted lookup (any depth). */
const lookup = (data: unknown, dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], data);

describe('memories fun strings', () => {
    it.each(Object.entries(locales))('%s has every fun key as a non-empty string', (_code, data) => {
        for (const dotted of MEMORIES_FUN_KEYS) {
            const value = lookup(data, dotted);
            expect(typeof value, dotted).toBe('string');
            expect(String(value).trim(), dotted).not.toBe('');
        }
    });

    it('English has the plural form of every counted fun key', () => {
        for (const dotted of MEMORIES_FUN_EN_PLURALS) expect(lookup(en, `${dotted}_other`), dotted).toBeTruthy();
    });

    it('lists every key once', () => {
        expect(new Set(MEMORIES_FUN_KEYS).size).toBe(MEMORIES_FUN_KEYS.length);
    });

    it.each(Object.entries(locales))('%s never prints a number in the gacha spent line', (_code, data) => {
        expect(String(lookup(data, 'memories.home.gachaTomorrow'))).not.toMatch(/\d|\{\{/);
        expect(String(lookup(data, 'memories.gacha.tomorrow'))).not.toMatch(/\d|\{\{/);
    });

    it('uses the Japanese reference copy', () => {
        const expected: Record<string, string> = {
            'memories.home.radio': 'ボイスラジオ',
            'memories.home.gacha': '思い出ガチャ',
            'memories.home.calendar': 'カレンダー',
            'memories.home.countVoices': '{{count, number}} 件のボイス',
            'memories.home.countGacha': '今日はあと {{count, number}} 回',
            'memories.home.countDays': '{{count, number}} 日分',
            'memories.home.gachaTomorrow': 'また明日',
            'memories.memoir.tabDay24': '彼女の24時間',
            'memories.radio.title': 'ボイスラジオ',
            'memories.radio.all': '全員',
            'memories.radio.station': '{{name}}の深夜放送局',
            'memories.radio.stationAll': '深夜放送局',
            'memories.radio.onAir': 'ON AIR',
            'memories.radio.offAir': 'OFF AIR',
            'memories.radio.programs.oyasumi': 'おやすみ放送',
            'memories.radio.programs.oyasumiSub': '夜9時から明け方までの声',
            'memories.radio.programs.ohayo': 'おはよう放送',
            'memories.radio.programs.ohayoSub': '朝5時から10時までの声',
            'memories.radio.programs.otsukare': 'おつかれチャージ',
            'memories.radio.programs.otsukareSub': '昼から夜までの声',
            'memories.radio.programs.chrono': 'あの頃から順番に',
            'memories.radio.programs.chronoSub': '選んだ年を、はじめから',
            'memories.radio.programs.favorites': '★ お気に入りの声',
            'memories.radio.programs.favoritesSub': '★をつけたボイス',
            'memories.radio.programs.oyasumiClips': '精選・おやすみだけ',
            'memories.radio.programs.oyasumiClipsSub': '“おやすみ”のところだけ',
            'memories.radio.trackCount': '{{count, number}} 件',
            'memories.radio.play': '再生',
            'memories.radio.pause': '一時停止',
            'memories.radio.next': '次の声',
            'memories.radio.prev': '前の声',
            'memories.radio.sleep': 'おやすみタイマー',
            'memories.radio.sleepOff': 'タイマーなし',
            'memories.radio.sleepMinutes': '{{count}} 分後に止める',
            'memories.radio.sleepLeft': 'あと {{count}} 分',
            'memories.radio.cassette': '{{year}}年のテープ',
            'memories.radio.cassetteLength': '{{length}}',
            'memories.radio.empty': 'ここで流せる声は、まだありません。',
            'memories.gacha.title': '思い出ガチャ',
            'memories.gacha.turn': 'ハンドルを回す',
            'memories.gacha.left': '今日はあと {{count, number}} 回',
            'memories.gacha.tomorrow': 'また明日',
            'memories.gacha.history': 'これまでに出た思い出',
            'memories.gacha.context': 'この日の前後を見る',
            'memories.gacha.favorite': '★をつける',
            'memories.gacha.unfavorite': '★をはずす',
            'memories.gacha.empty': 'ガチャに入れる思い出が、まだありません。',
            'memories.gacha.missing': 'このメッセージは見つかりませんでした',
            'memories.gacha.rarity.n': 'ノーマル',
            'memories.gacha.rarity.r': 'R',
            'memories.gacha.rarity.sr': 'SR',
            'memories.gacha.reason.midnight': '日付が変わった瞬間',
            'memories.gacha.reason.birthday': 'お誕生日のメッセージ',
            'memories.gacha.reason.subAnniversary': 'あなたの記念日のメッセージ',
            'memories.gacha.reason.lastMessage': '最後のメッセージ',
            'memories.gacha.reason.nickname': '名前を呼んでくれた',
            'memories.gacha.reason.favorite': '★をつけたメッセージ',
            'memories.gacha.reason.voice': '声',
            'memories.gacha.reason.message': 'メッセージ',
            'memories.gacha.reason.photo': '写真',
            'memories.gacha.refreshFailed': 'ガチャの結果を確かめられませんでした',
            'memories.calendar.title': 'カレンダー',
            'memories.calendar.all': '全員',
            'memories.calendar.members': '{{count}} 人のメンバー',
            'memories.calendar.prevMonth': '前の月',
            'memories.calendar.nextMonth': '次の月',
            'memories.calendar.pickMonth': '年月をえらぶ',
            'memories.calendar.empty': 'この月の思い出は、まだありません。',
            'memories.album.setCover': 'この月の表紙にする',
            'memories.album.resetCover': '表紙を自動にもどす',
            'memories.album.coverFailed': '表紙を変えられませんでした',
        };
        for (const [key, text] of Object.entries(expected)) expect(lookup(ja, key), key).toBe(text);
    });
});
