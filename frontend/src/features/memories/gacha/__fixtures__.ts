import { memoryMessage, MEMBER_PATH } from '../__fixtures__/memories';
import type { GachaMessage, GachaPull, GachaPullPayload, GachaStatePayload } from '../types';

export { MEMBER_PATH };

/** A pull (her text message 123, an N `message`, pulled 2026-11-10 JST, index 0); overrides win. */
export function gachaPull(over: Partial<GachaPull> = {}, message: Partial<GachaMessage> = {}): GachaPull {
    return {
        jst_date: '2026-11-10',
        pull_index: 0,
        rarity: 'n',
        reason: 'message',
        pulled_at: '2026-11-10T03:00:00Z',
        message: { ...memoryMessage({ text: '%%%、おはよう🌸' }), ...message },
        ...over,
    };
}

/** A pull whose message is no longer in the archive: `ts`, `type` and `text` are null. */
export function missingPull(over: Partial<GachaPull> = {}): GachaPull {
    return gachaPull({ jst_date: '2026-11-08', rarity: 'r', reason: 'voice', ...over }, {
        id: 77, ts: null, type: null, text: null,
    });
}

export function gachaState(over: Partial<GachaStatePayload> = {}): GachaStatePayload {
    return {
        available: true,
        pulls_left: 3,
        max_pulls: 3,
        today: [],
        history: [],
        ...over,
    };
}

export function pullPayload(pull: GachaPull | null = gachaPull(), pullsLeft = 2): GachaPullPayload {
    return { pull, pulls_left: pullsLeft };
}
