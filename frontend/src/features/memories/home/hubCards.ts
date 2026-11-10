import type { LucideIcon } from 'lucide-react';
import { BookHeart, CalendarDays, Gift, ImageIcon, Radio, Sparkles, Star } from 'lucide-react';
import type { MemoriesRoute } from '../MemoriesFeature';
import type { HubCounts, HubPayload } from '../types';

/** Something the hub does on a card click that is not a plain route (the recap needs its year). */
export type HubCardAction = 'recap';

/**
 * The numbers a hub card can show: the payload's `counts` merged with its top-level `gacha_left`
 * ({@link hubCardCounts}). `gacha_left` is null when the fan's store failed.
 */
export type HubCardCounts = HubCounts & { gacha_left: number | null };

interface HubCardBase {
    id: string;
    icon: LucideIcon;
    /** The card title (`memories.home.*`). */
    titleKey: string;
}

/** A card shows a count only with its line: both fields or neither. */
type HubCardCount =
    | {
        /** The hub count this card shows (`counts[countKey]`). */
        countKey: keyof HubCardCounts;
        /** The count's line, with `{{count}}` (plural-aware). */
        countLabelKey: string;
        /**
         * The line for a count of exactly 0, without a number (the gacha's 「また明日」). Without it
         * a 0 shows no line (spec 1.1: never a "0").
         */
        zeroLabelKey?: string;
    }
    | { countKey?: never; countLabelKey?: never; zeroLabelKey?: never };

/** One entry card of the hub: either a route or an action, never both; a count with its line, or none. */
export type HubCardDef = HubCardBase & HubCardCount & (
    | { route: MemoriesRoute; action?: never }
    | { action: HubCardAction; route?: never }
);

/**
 * The hub's entry cards, in board order. The recap card is drawn by `RecapHubCard` (its shelf
 * states); the others by `HubEntryCard`.
 */
export const HUB_CARDS: readonly HubCardDef[] = [
    { id: 'album', icon: ImageIcon, titleKey: 'memories.home.album', route: { page: 'album' }, countKey: 'album', countLabelKey: 'memories.home.countAlbum' },
    { id: 'memoir', icon: BookHeart, titleKey: 'memories.home.memoir', route: { page: 'memoir' }, countKey: 'members', countLabelKey: 'memories.home.countMembers' },
    { id: 'favorites', icon: Star, titleKey: 'memories.home.favorites', route: { page: 'favorites' }, countKey: 'favorites', countLabelKey: 'memories.home.countFavorites' },
    { id: 'recap', icon: Sparkles, titleKey: 'memories.home.recapCard', action: 'recap' },
    { id: 'radio', icon: Radio, titleKey: 'memories.home.radio', route: { page: 'radio' }, countKey: 'voices', countLabelKey: 'memories.home.countVoices' },
    {
        id: 'gacha', icon: Gift, titleKey: 'memories.home.gacha', route: { page: 'gacha' },
        countKey: 'gacha_left', countLabelKey: 'memories.home.countGacha', zeroLabelKey: 'memories.home.gachaTomorrow',
    },
    { id: 'calendar', icon: CalendarDays, titleKey: 'memories.home.calendar', route: { page: 'calendar' }, countKey: 'days', countLabelKey: 'memories.home.countDays' },
];

/**
 * The hub counts the cards read: `counts` plus the top-level `gacha_left` (one map, so every
 * card's `countKey` reads it the same way), or null while the hub loads or after it failed.
 */
export function hubCardCounts(payload: HubPayload | null | undefined): HubCardCounts | null {
    return payload ? { ...payload.counts, gacha_left: payload.gacha_left } : null;
}

/** A card's raw value, or null (no count key, no counts yet, or a null / non-finite value). */
function rawCount(card: HubCardDef, counts: HubCardCounts | null): number | null {
    if (!card.countKey || !counts) return null;
    const value = counts[card.countKey];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The number a card shows, or null: no count key, no counts yet (loading / failed), a null
 * value (the store failed) or a count that is not above zero (spec 1.1: never a "0").
 */
export function hubCardCount(card: HubCardDef, counts: HubCardCounts | null): number | null {
    const value = rawCount(card, counts);
    return value !== null && value > 0 ? value : null;
}

/** A card's line: its count line with the number, its zero line without one, or none. */
export type HubCardLine = { key: string; count: number } | { key: string; count?: never } | null;

/**
 * The line under a card's title: above zero, `countLabelKey` with the count; exactly 0, the
 * card's `zeroLabelKey` (no number) or nothing; null / loading / no count key, nothing.
 */
export function hubCardLine(card: HubCardDef, counts: HubCardCounts | null): HubCardLine {
    if (!card.countKey) return null;
    const count = hubCardCount(card, counts);
    if (count !== null) return { key: card.countLabelKey, count };
    if (rawCount(card, counts) === 0 && card.zeroLabelKey) return { key: card.zeroLabelKey };
    return null;
}
