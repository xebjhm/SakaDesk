import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

const EXPECTED: Record<keyof typeof locales, Record<string, string>> = {
    ja: {
        title: '思い出の通知',
        desc: '思い出を開いている間は通知しません',
        onThisDay: '毎日の「あの日」',
        onThisDayDesc: '過去の同じ日にメッセージがある日だけ、1日1回',
        time: '通知の時刻',
        timeDesc: '毎日の「あの日」、誕生日のお知らせ、記念日、12月のふりかえりの時刻（当日の誕生日は0時、1月の完成は1月1日0時から）',
        timeHint: '日本時間。お住まいの地域では {{local}}',
        birthday: '誕生日',
        birthdayDesc: '当日の0時と、7日前・前日のお知らせ',
        anniversary: 'メンバーシップ記念日',
        anniversaryDesc: '1年ごとの記念日と、100日・500日・1000日',
        recap: '一年の振り返り',
        recapDesc: '12月1日の公開、クリスマス、1月の完成',
        cards: 'きらめくカード',
        cardsDesc: '生写真帳に特別なカードが加わったとき',
    },
    en: {
        title: 'Memories notifications',
        desc: 'Not shown while you are in Memories',
        onThisDay: 'On This Day, daily',
        onThisDayDesc: 'Once a day, only when past years have messages on that date',
        time: 'Time',
        timeDesc: 'The time for On This Day, birthday reminders, anniversaries and the December recap notices (birthdays on the day at midnight; the complete recap from midnight on Jan 1)',
        timeHint: 'Japan time ({{local}} where you are)',
        birthday: 'Birthdays',
        birthdayDesc: 'At midnight on the day, plus 7 days and 1 day before',
        anniversary: 'Membership anniversaries',
        anniversaryDesc: 'Each year, plus day 100, 500 and 1000',
        recap: 'Year recap',
        recapDesc: 'When it opens on Dec 1, at Christmas, and when it is complete in January',
        cards: 'Foil cards',
        cardsDesc: 'When a special card joins a binder',
    },
    'zh-TW': {
        title: '回憶通知',
        desc: '正在看回憶時不會通知',
        onThisDay: '每日的「那一天」',
        onThisDayDesc: '只在往年同一天有訊息時，每天一次',
        time: '通知時間',
        timeDesc: '每日的「那一天」、生日提醒、紀念日與12月回顧通知的時間（生日當天為0點，1月的完整回顧從1月1日0點起）',
        timeHint: '日本時間（你所在地區為 {{local}}）',
        birthday: '生日',
        birthdayDesc: '當天0點，以及7天前和前一天提醒',
        anniversary: '會員紀念日',
        anniversaryDesc: '每週年，以及第100、500、1000天',
        recap: '年度回顧',
        recapDesc: '12月1日開放、聖誕節，以及1月完整時',
        cards: '閃亮卡片',
        cardsDesc: '相冊多了特別的卡時',
    },
    'zh-CN': {
        title: '回忆通知',
        desc: '正在看回忆时不会通知',
        onThisDay: '每日的“那一天”',
        onThisDayDesc: '只在往年同一天有消息时，每天一次',
        time: '通知时间',
        timeDesc: '每日的“那一天”、生日提醒、纪念日与12月回顾通知的时间（生日当天为0点，1月的完整回顾从1月1日0点起）',
        timeHint: '日本时间（你所在地区为 {{local}}）',
        birthday: '生日',
        birthdayDesc: '当天0点，以及7天前和前一天提醒',
        anniversary: '会员纪念日',
        anniversaryDesc: '每周年，以及第100、500、1000天',
        recap: '年度回顾',
        recapDesc: '12月1日开放、圣诞节，以及1月完整时',
        cards: '闪亮卡片',
        cardsDesc: '相册多了特别的卡时',
    },
    yue: {
        title: '回憶通知',
        desc: '睇緊回憶嗰陣唔會通知',
        onThisDay: '每日嘅「嗰一日」',
        onThisDayDesc: '淨係往年同一日有訊息先通知，每日一次',
        time: '通知時間',
        timeDesc: '每日嘅「嗰一日」、生日提醒、紀念日同12月回顧通知嘅時間（生日當日係0點，1月嘅完整回顧由1月1日0點起）',
        timeHint: '日本時間（你嗰邊係 {{local}}）',
        birthday: '生日',
        birthdayDesc: '當日0點，同埋7日前同前一日提醒',
        anniversary: '會員紀念日',
        anniversaryDesc: '每週年，同埋第100、500、1000日',
        recap: '年度回顧',
        recapDesc: '12月1日開放、聖誕節，同埋1月齊晒嗰陣',
        cards: '閃卡',
        cardsDesc: '相冊多咗張特別卡嗰陣',
    },
};

type Tree = Record<string, Record<string, Record<string, string>>>;

describe('Memories notification setting strings', () => {
    it.each(Object.entries(EXPECTED))('%s uses the agreed wording', (code, want) => {
        const section = (locales[code as keyof typeof locales] as unknown as Tree).settings.memoriesNotify;
        expect(section, code).toBeTruthy();
        for (const [key, value] of Object.entries(want)) {
            expect(section[key], `${code}.${key}`).toBe(value);
        }
        expect(Object.keys(section).sort()).toEqual(Object.keys(want).sort());
    });

    it.each(Object.keys(EXPECTED))('%s keeps {{local}} in the time hint', (code) => {
        const section = (locales[code as keyof typeof locales] as unknown as Tree).settings.memoriesNotify;
        expect(section.timeHint).toContain('{{local}}');
    });

    it('names the recap like the Memories hub card in every locale', () => {
        for (const code of Object.keys(locales) as (keyof typeof locales)[]) {
            const tree = locales[code] as unknown as Tree & { memories: { home: { recapCard: string } } };
            expect(tree.settings.memoriesNotify.recap, code).toBe(tree.memories.home.recapCard);
        }
    });
});
