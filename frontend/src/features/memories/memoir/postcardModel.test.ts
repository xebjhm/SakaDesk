import { describe, it, expect } from 'vitest';
import { card, face } from './__fixtures__';
import { isPostcardCard, postcardTheme, postcardYears, postmarkDay, stackYears } from './postcardModel';

describe('postcard model', () => {
    it('makes one postcard per stacked year, oldest first, with its photo', () => {
        const photo = face({ id: 9, type: 'picture', text: null });
        const c = card({
            key: 'special.birthday', date: '2025-02-28',
            years: [
                { year: 2024, date: '2024-02-29', face: face({ id: 1 }), photo },
                { year: 2025, date: '2025-02-28', face: face({ id: 2 }), photo: null },
            ],
        });
        expect(postcardYears(c).map((p) => [p.year, p.face?.id, p.photo?.id ?? null])).toEqual([[2024, 1, 9], [2025, 2, null]]);
    });

    it('makes one postcard of a card without years from its date, face and refs.photo', () => {
        const c = card({ key: 'special.join_day', date: '2024-07-24', face: null, refs: { photo: face({ id: 5 }) } });
        expect(postcardYears(c)).toEqual([{ year: 2024, date: '2024-07-24', face: null, photo: expect.objectContaining({ id: 5 }) }]);
        expect(postcardYears(card({ key: 'special.join_day', date: null }))).toEqual([]);
    });

    it('themes each special day', () => {
        expect(postcardTheme('special.newyear')).toBe('newyear');
        expect(postcardTheme('special.birthday')).toBe('birthday');
        expect(postcardTheme('special.join_day')).toBe('anniversary');
        expect(postcardTheme('special.sub_anniversary')).toBe('anniversary');
        expect(postcardTheme('special.christmas')).toBe('christmas');
        expect(postcardTheme('special.valentine')).toBe('valentine');
        expect(isPostcardCard(card({ key: 'special.newyear' }))).toBe(true);
        expect(isPostcardCard(card({ key: 'record.longest' }))).toBe(false);
    });

    it('prints the postmark day and the stack years', () => {
        expect(postmarkDay('2026-01-01')).toBe('1.1');
        expect(postmarkDay('2025-11-23')).toBe('11.23');
        expect(stackYears([2025, 2026])).toBe('2025・2026');
        expect(stackYears([2021, 2022, 2023, 2024, 2025])).toBe('2021–2025');
    });
});
