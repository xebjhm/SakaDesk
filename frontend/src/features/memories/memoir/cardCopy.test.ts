import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ja from '../../../i18n/locales/ja.json';
import { cardCopy } from './cardCopy';

/** The binder's rules: the backend's card-key catalogue (`cards.py`). */
const CARDS_PY = path.resolve(__dirname, '../../../../../backend/services/memories/cards.py');
const SOURCE = readFileSync(CARDS_PY, 'utf-8');

const lookup = (dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], ja);

/** The integers of a module-level tuple constant, e.g. `_STREAKS = (7, 30, 100)`. */
function intTuple(name: string): number[] {
    const m = new RegExp(`^${name} = \\(([^)]*)\\)`, 'm').exec(SOURCE);
    if (!m) throw new Error(`${name} not found in cards.py`);
    return m[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
}

/** The string values of the one `for <name> in ("a", "b")` loop (two such loops fail: ambiguous). */
function loopValues(name: string): string[] {
    const loops = [...SOURCE.matchAll(new RegExp(`for ${name} in \\(([^)]*)\\)`, 'g'))];
    if (loops.length !== 1) throw new Error(`expected one loop over ${name} in cards.py, found ${loops.length}`);
    return [...loops[0][1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/**
 * Sample values for every placeholder an f-string card key uses, read from `cards.py` where it
 * names them. A new placeholder fails the walk until it is added here (and to `cardCopy`).
 */
const PLACEHOLDERS: Record<string, Record<string, string[]>> = {
    'first.{kind}': { kind: loopValues('kind') },
    'anniv.y{year}': { year: ['6', '7', '12'] },
    'count.messages.{n}': { n: intTuple('_MESSAGE_COUNTS').map(String) },
    'count.pictures.{n}': { n: intTuple('_PICTURE_COUNTS').map(String) },
    'record.streak.{n}': { n: intTuple('_STREAKS').map(String) },
    'moment.{greeting}.1': { greeting: loopValues('greeting') },
    'moment.{greeting}.100': { greeting: loopValues('greeting') },
    'you.letter.{n}': { n: intTuple('_LETTER_COUNTS').map(String) },
    // a second change on one day gets `.2` (`f"{base}.{used[base]}"`)
    'change.avatar.{day.isoformat()}': { 'day.isoformat()': ['2024-05-01', '2024-05-01.2', '2025-12-31.3'] },
};

/** Every card key `cards.py` can emit: its literals and its f-string templates expanded. */
function backendKeys(): string[] {
    // double- or single-quoted literals and f-strings with a shelf prefix
    const templates = new Set(
        [...SOURCE.matchAll(/f?(["'])((?:first|anniv|count|special|record|moment|you|change|grad)\.[^"']*)\1/g)].map((m) => m[2]),
    );
    const keys: string[] = [];
    for (const template of templates) {
        const holes = [...template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
        if (!holes.length) {
            keys.push(template);
            continue;
        }
        const samples = PLACEHOLDERS[template];
        if (!samples) throw new Error(`no samples for the card key template ${template}`);
        let expanded = [template];
        for (const hole of holes) {
            const values = samples[hole];
            if (!values?.length) throw new Error(`no samples for {${hole}} in ${template}`);
            expanded = expanded.flatMap((k) => values.map((v) => k.replace(`{${hole}}`, v)));
        }
        keys.push(...expanded);
    }
    return keys;
}

describe('cardCopy', () => {
    it('maps the generic key patterns with their numbers', () => {
        expect(cardCopy('anniv.d100')?.title).toEqual({ key: 'memories.cards.annivDays', params: { days: 100 } });
        expect(cardCopy('anniv.y3')?.title).toEqual({ key: 'memories.cards.annivYears', params: { years: 3 } });
        expect(cardCopy('anniv.y12')?.title).toEqual({ key: 'memories.cards.annivYears', params: { years: 12 } });
        expect(cardCopy('count.messages.5000')?.title).toEqual({ key: 'memories.cards.countMessages', params: { count: 5000 } });
        expect(cardCopy('count.pictures.100')?.title).toEqual({ key: 'memories.cards.countPictures', params: { count: 100 } });
        expect(cardCopy('record.streak.30')?.title).toEqual({ key: 'memories.cards.streak', params: { days: 30 } });
        expect(cardCopy('you.letter.1')?.title).toEqual({ key: 'memories.cards.letterFirst' });
        expect(cardCopy('you.letter.50')?.title).toEqual({ key: 'memories.cards.letters', params: { count: 50 } });
        expect(cardCopy('change.avatar.2024-05-01')?.title).toEqual({ key: 'memories.cards.avatarChange' });
        expect(cardCopy('change.avatar.2024-05-01.2')?.title).toEqual({ key: 'memories.cards.avatarChange' });
        expect(cardCopy('moment.oyasumi.100')?.title).toEqual({ key: 'memories.cards.oyasumi100' });
        expect(cardCopy('grad.last')?.title).toEqual({ key: 'memories.cards.lastMessage' });
    });

    it('gives every card its own condition, with the same number', () => {
        expect(cardCopy('first.picture')?.condition).toEqual({ key: 'memories.cards.firstPictureCondition' });
        expect(cardCopy('moment.synchro')?.condition).toEqual({ key: 'memories.cards.synchroCondition' });
        expect(cardCopy('count.messages.100')?.condition).toEqual({ key: 'memories.cards.countMessagesCondition', params: { count: 100 } });
        expect(cardCopy('change.avatar.2024-05-01.2')?.condition).toEqual({ key: 'memories.cards.avatarChangeCondition' });
    });

    it('returns null for a key it does not know', () => {
        expect(cardCopy('season.spring')).toBeNull();
        expect(cardCopy('anniv.x5')).toBeNull();
        expect(cardCopy('count.messages.abc')).toBeNull();
    });

    it('covers every card key the backend catalogue can emit', () => {
        const keys = backendKeys();
        // the walk really reached the catalogue (shelves, generic patterns, per-date avatar keys)
        expect(keys).toEqual(expect.arrayContaining([
            'first.message', 'first.voice', 'anniv.d1000', 'anniv.y12', 'count.messages.10000', 'count.voice_hour',
            'special.sub_anniversary', 'special.join_day', 'record.greeting_pair', 'record.streak.100', 'moment.synchro', 'moment.daisuki.1',
            'you.letter.10', 'change.avatar.2024-05-01.2', 'grad.last',
        ]));
        for (const key of keys) {
            const copy = cardCopy(key);
            expect(copy, key).not.toBeNull();
            expect(typeof lookup(copy!.title.key), `${key} title`).toBe('string');
            expect(copy!.condition.key, `${key} condition`).toBe(`${copy!.title.key}Condition`);
            expect(typeof lookup(copy!.condition.key), `${key} condition`).toBe('string');
        }
    });
});
