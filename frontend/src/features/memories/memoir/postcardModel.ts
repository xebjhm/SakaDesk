/** Pure helpers of the 特別な日 postcards (kept out of the component file for fast refresh). */
import type { BinderCard, MemoryMessage } from '../types';

/** One year of a special day: a postcard she sent that year. */
export interface PostcardYear {
    year: number;
    /** JST `YYYY-MM-DD`. */
    date: string;
    face: MemoryMessage | null;
    /** That day's best photo when the face is not itself one (`CardYear.photo`). */
    photo: MemoryMessage | null;
}

/** The look of a special day's postcard: 元旦 a 年賀状, her birthday a birthday card, the fan's days an anniversary card. */
export type PostcardTheme = 'newyear' | 'birthday' | 'anniversary' | 'valentine' | 'christmas';

const THEMES: Record<string, PostcardTheme> = {
    'special.newyear': 'newyear',
    'special.birthday': 'birthday',
    'special.join_day': 'anniversary',
    'special.sub_anniversary': 'anniversary',
    'special.valentine': 'valentine',
    'special.christmas': 'christmas',
};

/** The shelf whose earned cards are drawn as postcards. */
export const isPostcardCard = (card: BinderCard): boolean => card.key.startsWith('special.');

/** The postcard theme of a special-day card (an unknown special key reads as an anniversary card). */
export const postcardTheme = (key: string): PostcardTheme => THEMES[key] ?? 'anniversary';

/**
 * A special-day card's postcards, oldest first: one per stacked year, or, for a card without
 * years (加入紀念日), one from its own date, face and `refs.photo`.
 */
export function postcardYears(card: BinderCard): PostcardYear[] {
    if (card.years.length > 0) {
        return card.years.map((y) => ({ year: y.year, date: y.date, face: y.face, photo: y.photo ?? null }));
    }
    if (!card.date) return [];
    return [{ year: Number(card.date.slice(0, 4)), date: card.date, face: card.face, photo: card.refs.photo ?? null }];
}

/** `YYYY-MM-DD` as the postmark's `M.D`. */
export function postmarkDay(day: string): string {
    const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(day);
    return m ? `${Number(m[1])}.${Number(m[2])}` : day;
}

/** The years under a stack: every year up to four, else the first and the last (「2021–2026」). */
export function stackYears(years: readonly number[]): string {
    if (years.length <= 4) return years.join('・');
    return `${years[0]}–${years[years.length - 1]}`;
}

/** At most this many postcards are drawn in a shelf stack (the newest on top). */
export const STACK_LAYERS = 3;
