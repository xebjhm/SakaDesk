import type { HubCountdown, HubMoment, HubPayload } from '../types';
import { MEMBER_PATH, memoryMessage } from '../__fixtures__/memories';

/** The hub moment (rule `today` by default; overrides win). */
export function hubMoment(over: Partial<HubMoment> = {}): HubMoment {
    return {
        rule: 'today',
        year: 2024,
        years_ago: 2,
        date: '2024-11-10',
        member_path: MEMBER_PATH,
        name: '金村 美玖',
        message: memoryMessage({ id: 501, ts: '2024-11-10T03:00:00Z', text: '%%%、おはよう🌸 今日もがんばろうね' }),
        photo: memoryMessage({ id: 502, type: 'picture', text: null, media_url: '/api/content/media/hinatazaka46/p.jpg' }),
        ...over,
    };
}

export function hubCountdown(over: Partial<HubCountdown> = {}): HubCountdown {
    return {
        kind: 'birthday', member_path: MEMBER_PATH, name: '金村 美玖', date: '2026-11-22', days_left: 12, years: null,
        ...over,
    };
}

export function hubPayload(over: Partial<HubPayload> = {}): HubPayload {
    return {
        on_this_day: hubMoment(),
        counts: { album: 8412, members: 27, favorites: 96 },
        countdown: hubCountdown(),
        same_time: null,
        capsule: null,
        ...over,
    };
}
