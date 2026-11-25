import type { GachaRarity, GachaReason } from '../types';

/** The rarity label's key (`ノーマル` / `R` / `SR`). */
const RARITY_KEYS: Record<GachaRarity, string> = {
    n: 'memories.gacha.rarity.n',
    r: 'memories.gacha.rarity.r',
    sr: 'memories.gacha.rarity.sr',
};

/** Each `gacha.classify` reason code's line, literally what the rule found. */
const REASON_KEYS: Record<GachaReason, string> = {
    midnight: 'memories.gacha.reason.midnight',
    birthday: 'memories.gacha.reason.birthday',
    // The fan's own subscription anniversary: a message sent that day, never one sent for it.
    sub_anniversary: 'memories.gacha.reason.subAnniversary',
    last_message: 'memories.gacha.reason.lastMessage',
    nickname: 'memories.gacha.reason.nickname',
    favorite: 'memories.gacha.reason.favorite',
    voice: 'memories.gacha.reason.voice',
    photo: 'memories.gacha.reason.photo',
    message: 'memories.gacha.reason.message',
};

/** A rarity's fill (semantic tokens; literal names so Tailwind sees them, never built at runtime). */
export const RARITY_FILL: Record<GachaRarity, string> = {
    n: 'bg-memories-rarity-n',
    r: 'bg-memories-rarity-r',
    sr: 'bg-memories-rarity-sr',
};

export const rarityKey = (rarity: GachaRarity): string => RARITY_KEYS[rarity];
export const reasonKey = (reason: GachaReason): string => REASON_KEYS[reason];
