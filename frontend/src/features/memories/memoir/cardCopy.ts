/**
 * Binder card copy: a backend card key (`backend/services/memories/cards.py`) to its i18n keys.
 *
 * Fixed keys map one to one; the numbered families are matched by pattern, so every key the
 * catalogue can emit has copy (`cardCopy.test.ts` walks `cards.py`):
 *
 * - `anniv.dN` → `annivDays` (`days`), `anniv.yN` → `annivYears` (`years`, yearly from 6 on);
 * - `count.messages.N` / `count.pictures.N` → `countMessages` / `countPictures` (`count`);
 * - `record.streak.N` → `streak` (`days`);
 * - `you.letter.1` → `letterFirst`, `you.letter.N` → `letters` (`count`);
 * - `change.avatar.<date>` and a same-day `change.avatar.<date>.<n>` → `avatarChange`.
 *
 * `condition` is what an unearned silhouette shows: the title's `…Condition` key with the same
 * number (「1,000通目が届いたら」, 「別々の日に、同じ時刻のメッセージ」). Every card has one.
 */

export interface CopyRef {
    key: string;
    params?: Record<string, number>;
}

export interface CardCopy {
    title: CopyRef;
    condition: CopyRef;
}

const P = 'memories.cards.';

const FIXED: Record<string, string> = {
    'first.message': 'firstMessage',
    'first.picture': 'firstPicture',
    'first.video': 'firstVideo',
    'first.voice': 'firstVoice',
    'first.nickname': 'firstNickname',
    'count.voice_hour': 'voiceHour',
    'count.nicknames.100': 'nicknames100',
    'special.newyear': 'newyear',
    'special.valentine': 'valentine',
    'special.christmas': 'christmas',
    'special.birthday': 'birthday',
    'special.sub_anniversary': 'subAnniversary',
    'record.longest': 'longest',
    'record.busiest_day': 'busiestDay',
    'record.nickname_day': 'nicknameDay',
    'record.longest_voice': 'longestVoice',
    'record.greeting_pair': 'greetingPair',
    'moment.midnight': 'midnight',
    'moment.synchro': 'synchro',
    'moment.oyasumi.1': 'oyasumiFirst',
    'moment.oyasumi.100': 'oyasumi100',
    'moment.daisuki.1': 'daisukiFirst',
    'moment.daisuki.100': 'daisuki100',
    'you.letter.1': 'letterFirst',
    'grad.last': 'lastMessage',
};

/** Numbered families: the key pattern, its copy and the param its number fills. */
const PATTERNS: Array<{ re: RegExp; copy: string; param: string }> = [
    { re: /^anniv\.d(\d+)$/, copy: 'annivDays', param: 'days' },
    { re: /^anniv\.y(\d+)$/, copy: 'annivYears', param: 'years' },
    { re: /^count\.messages\.(\d+)$/, copy: 'countMessages', param: 'count' },
    { re: /^count\.pictures\.(\d+)$/, copy: 'countPictures', param: 'count' },
    { re: /^record\.streak\.(\d+)$/, copy: 'streak', param: 'days' },
    { re: /^you\.letter\.(\d+)$/, copy: 'letters', param: 'count' },
];

const AVATAR_CHANGE = /^change\.avatar\.\d{4}-\d{2}-\d{2}(?:\.\d+)?$/;

function title(cardKey: string): CopyRef | null {
    const fixed = FIXED[cardKey];
    if (fixed) return { key: P + fixed };
    if (AVATAR_CHANGE.test(cardKey)) return { key: `${P}avatarChange` };
    for (const { re, copy, param } of PATTERNS) {
        const m = re.exec(cardKey);
        if (m) return { key: P + copy, params: { [param]: Number(m[1]) } };
    }
    return null;
}

/** The card's title and silhouette condition, or null for a key this build has no copy for. */
export function cardCopy(cardKey: string): CardCopy | null {
    const t = title(cardKey);
    if (!t) return null;
    return { title: t, condition: { ...t, key: `${t.key}Condition` } };
}
