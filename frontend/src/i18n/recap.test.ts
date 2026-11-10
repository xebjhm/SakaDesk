import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Every recap string (R4; later recap tasks append). */
const RECAP_KEYS: readonly string[] = [
    'recap.entry.heading', 'recap.entry.year', 'recap.entry.olderYear', 'recap.entry.newerYear', 'recap.entry.back',
    'recap.entry.choose', 'recap.entry.partial', 'recap.entry.loadFailed', 'recap.entry.oshi',
    'recap.entry.emptyTitle', 'recap.entry.emptyBody',
    'recap.titles.morning', 'recap.titles.nickname', 'recap.titles.longest', 'recap.titles.voice',
    'recap.titles.night', 'recap.titles.photos', 'recap.titles.steady', 'recap.titles.first',
    'recap.player.label', 'recap.player.prev', 'recap.player.next', 'recap.player.pause', 'recap.player.play',
    'recap.player.progress', 'recap.youFallback',
    'recap.s01.title', 'recap.s01.sub', 'recap.s01.joined', 'recap.s01.notification',
    'recap.s02.title', 'recap.s02.count', 'recap.s02.single', 'recap.s02.daisuki', 'recap.s02.daisukiWord', 'recap.s02.daisukiTitle', 'recap.s02.daisukiSingle',
    'recap.s03.titleNight', 'recap.s03.titleMorning', 'recap.s03.titleNoon', 'recap.s03.peak', 'recap.s03.flat',
    'recap.s03.streak', 'recap.s03.clockLabel',
    'recap.s04.title', 'recap.s04.titleDay', 'recap.s04.titleMorning', 'recap.s04.titleEvening',
    'recap.s04.firstOhayo', 'recap.s04.firstMorning', 'recap.s04.latestOyasumi', 'recap.s04.latestArigato',
    'recap.s04.latestOtsukare', 'recap.s04.countOyasumi', 'recap.s04.countArigato', 'recap.s04.countOtsukare',
    'recap.s05.title', 'recap.s05.mostlyBursts', 'recap.s05.bestPhoto', 'recap.s05.burstLabel',
    'recap.s06.title', 'recap.s06.play', 'recap.s06.hint', 'recap.s06.playing', 'recap.s06.video', 'recap.s06.count',
    'recap.s07.title', 'recap.s07.count',
    'recap.s08.title', 'recap.s08.titleYears', 'recap.s08.titleEcho', 'recap.s08.keyword', 'recap.s08.years',
    'recap.s08.firstWeekTitle', 'recap.s08.firstWeek', 'recap.s08.now',
    'recap.s09.title', 'recap.s09.birthday', 'recap.s09.christmas', 'recap.s09.newyear', 'recap.s09.anniversary',
    'recap.s09.anniversaryNote', 'recap.s09.sealed',
    'recap.s10.title', 'recap.s10.favorites', 'recap.s10.letters', 'recap.s10.lettersLabel', 'recap.s10.firstFavorite',
    'recap.s10.bookLabel', 'recap.s10.inviteTitle', 'recap.s10.inviteFavorites', 'recap.s10.inviteLetters',
    'recap.s11.title', 'recap.s11.joyTitle', 'recap.s11.petalsLabel',
    'recap.s12.title',
    'recap.s13.title', 'recap.s13.partialTitle', 'recap.s13.partialNote', 'recap.s13.narration',
    'recap.s13.graduatedTitle', 'recap.s13.graduatedLine', 'recap.s13.lastTextTitle', 'recap.s13.lastTextPartialTitle', 'recap.s13.lastTextPartialNote',
];

/** Recap keys with an English plural (`<key>_other` in en.json only, the repo's pattern). */
const EN_PLURALS: readonly string[] = [
    'recap.s02.count', 'recap.s02.daisuki', 'recap.s03.streak',
    'recap.s04.countOyasumi', 'recap.s04.countArigato', 'recap.s04.countOtsukare', 'recap.s06.count',
    'recap.s07.count', 'recap.s08.titleYears', 'recap.s08.years', 'recap.s10.favorites', 'recap.s10.letters',
];

const lookup = (data: unknown, dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], data);

describe('recap strings', () => {
    it.each(Object.entries(locales))('%s has every recap key', (_code, data) => {
        for (const dotted of RECAP_KEYS) expect(lookup(data, dotted), dotted).toBeTruthy();
    });

    it('English has the plural form of every counted recap key', () => {
        for (const dotted of EN_PLURALS) expect(lookup(en, `${dotted}_other`), dotted).toBeTruthy();
    });

    it('year copy takes the year as a parameter, never a hard-coded year', () => {
        for (const data of Object.values(locales)) {
            expect(JSON.stringify(lookup(data, 'recap'))).not.toMatch(/20\d\d/);
        }
    });

    it('daisuki copy never says or implies she called the fan\'s name', () => {
        // In daisuki mode she never wrote the fan's nickname, so no line may claim a name or a call.
        const NAME_OR_CALL = /名前|呼|叫|喚|唤|\bname\b|\bcall/i;
        const DAISUKI_KEYS = ['recap.s02.daisukiTitle', 'recap.s02.daisuki', 'recap.s02.daisuki_other', 'recap.s02.daisukiSingle'];
        for (const [code, data] of Object.entries(locales)) {
            for (const dotted of DAISUKI_KEYS) {
                const text = lookup(data, dotted);
                if (text === undefined && dotted.endsWith('_other') && code !== 'en') continue;
                expect(text, `${code} ${dotted}`).toBeTruthy();
                expect(String(text), `${code} ${dotted}`).not.toMatch(NAME_OR_CALL);
            }
        }
    });

    it('the empty-state body looks forward and never describes thin data or an absence', () => {
        const ABSENCE = /まだ|少し|only a few|still|few|一點|一点|少少|還只|还只|仲係/i;
        for (const [code, data] of Object.entries(locales)) {
            expect(String(lookup(data, 'recap.entry.emptyBody')), code).not.toMatch(ABSENCE);
        }
    });
    it('the evening greeting is the latest by clock time, never called the year\'s latest or last', () => {
        // s04 picks the greeting sent latest in the night, not the most recent one of the year.
        const YEAR_LATEST = /今年|this year|of the year|最後|last|最新|最近|newest|recent/i;
        for (const [code, data] of Object.entries(locales)) {
            for (const v of ['Oyasumi', 'Arigato', 'Otsukare']) {
                expect(String(lookup(data, `recap.s04.latest${v}`)), `${code} ${v}`).not.toMatch(YEAR_LATEST);
            }
        }
    });

    it('the fan\'s own days and traces never say or imply that she saw, read or knew them', () => {
        // Messages are broadcast: s09's anniversary and every s10 line speak only of the fan's side.
        const KNEW = /読ん|見て|知って|覚え|気づ|read|saw|seen|knew|know|remember|notice|讀|读|看過|看过|睇過|睇过|知道|記得|记得|發現|发现/i;
        const KEYS = ['recap.s09.anniversary', 'recap.s09.anniversaryNote', 'recap.s10.title', 'recap.s10.favorites',
            'recap.s10.letters', 'recap.s10.lettersLabel', 'recap.s10.firstFavorite', 'recap.s10.bookLabel',
            'recap.s10.inviteTitle', 'recap.s10.inviteFavorites', 'recap.s10.inviteLetters'];
        for (const [code, data] of Object.entries(locales)) {
            for (const dotted of KEYS) expect(String(lookup(data, dotted)), `${code} ${dotted}`).not.toMatch(KNEW);
        }
    });

    it('the letter count shows the grouped number parameter, so 1,240 keeps its separator', () => {
        for (const [code, data] of Object.entries(locales)) {
            expect(String(lookup(data, 'recap.s07.count')), code).toContain('{{n}}');
            expect(String(lookup(data, 'recap.s07.count')), code).not.toContain('{{count}}');
        }
    });
});
