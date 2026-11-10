import type { LucideIcon } from 'lucide-react';
import { BookHeart, ImageIcon, Sparkles, Star } from 'lucide-react';
import type { MemoriesRoute } from '../MemoriesFeature';
import type { HubCounts } from '../types';

/** Something the hub does on a card click that is not a plain route (the recap needs its year). */
export type HubCardAction = 'recap';

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
        countKey: keyof HubCounts;
        /** The count's line, with `{{count}}` (plural-aware). */
        countLabelKey: string;
    }
    | { countKey?: never; countLabelKey?: never };

/** One entry card of the hub: either a route or an action, never both; a count with its line, or none. */
export type HubCardDef = HubCardBase & HubCardCount & (
    | { route: MemoriesRoute; action?: never }
    | { action: HubCardAction; route?: never }
);

/**
 * The hub's entry cards, in board order. Wave 4 appends voice radio, gacha and the calendar
 * album here. The recap card is drawn by `RecapHubCard` (its shelf states); the others by
 * `HubEntryCard`.
 */
export const HUB_CARDS: readonly HubCardDef[] = [
    { id: 'album', icon: ImageIcon, titleKey: 'memories.home.album', route: { page: 'album' }, countKey: 'album', countLabelKey: 'memories.home.countAlbum' },
    { id: 'memoir', icon: BookHeart, titleKey: 'memories.home.memoir', route: { page: 'memoir' }, countKey: 'members', countLabelKey: 'memories.home.countMembers' },
    { id: 'favorites', icon: Star, titleKey: 'memories.home.favorites', route: { page: 'favorites' }, countKey: 'favorites', countLabelKey: 'memories.home.countFavorites' },
    { id: 'recap', icon: Sparkles, titleKey: 'memories.home.recapCard', action: 'recap' },
];

/**
 * The number a card shows, or null: no count key, no counts yet (loading / failed), or a count
 * that is not above zero (spec 1.1: never a "0").
 */
export function hubCardCount(card: HubCardDef, counts: HubCounts | null): number | null {
    if (!card.countKey || !counts) return null;
    const value = counts[card.countKey];
    return Number.isFinite(value) && value > 0 ? value : null;
}
