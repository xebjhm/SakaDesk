import type { RecapMessage, RecapOverview, RecapPayload, RecapSlide } from '../api';

export const MEMBER_PATH = '日向坂46/messages/34 金村 美玖/58 金村 美玖';

export const message = (id: number, text: string | null, over: Partial<RecapMessage> = {}): RecapMessage => ({
    id,
    ts: '2026-01-01T15:00:07Z',
    type: 'text',
    text,
    media_url: null,
    caption: null,
    avatar_url: null,
    member_path: MEMBER_PATH,
    ...over,
});

export const s01: RecapSlide = {
    key: 's01_first',
    fallback: null,
    data: { message: message(1, '%%%、あけましておめでとう🌸'), joined_this_year: false, new_year_midnight: true },
};

export const s02: RecapSlide = {
    key: 's02_name',
    fallback: null,
    data: {
        mode: 'nickname',
        count: 42,
        first: message(2, '%%%、今日もありがとう'),
        last: null,
        fragments: ['%%%、またね'],
        single: false,
    },
};

export const s12: RecapSlide = {
    key: 's12_sentence',
    fallback: null,
    data: {
        sentence: '一緒に歩いてくれて、ありがとう。',
        message_id: 3,
        member_path: MEMBER_PATH,
        ts: '2026-06-01T12:00:00Z',
        photo_url: null,
    },
};

export const s13 = (final: boolean, graduated: boolean, fallback: string | null = null): RecapSlide => ({
    key: 's13_oyasumi',
    fallback,
    data: { message: message(4, 'おやすみ、%%%🌙'), final, graduated },
});

export const payload = (over: Partial<RecapPayload> = {}): RecapPayload => ({
    year: 2026,
    phase: 'partial',
    tier: 'full',
    member: {
        id: '58',
        name: '金村 美玖',
        avatar_url: null,
        graduated: false,
        subscription_start: '2024-07-24',
        years_together: 3,
    },
    slides: [s01, s02, s12, s13(false, false)],
    poster: {},
    ...over,
});

export const overview = (over: Partial<RecapOverview> = {}): RecapOverview => ({
    year: 2026,
    phase: 'partial',
    christmas_open: false,
    members: [
        { member_path: MEMBER_PATH, member_id: '58', name: '金村 美玖', tier: 'full', oshi: true, title_key: 'recap.titles.nickname' },
        { member_path: '日向坂46/messages/12 小坂 菜緒/12 小坂 菜緒', member_id: '12', name: '小坂 菜緒', tier: 'none', oshi: false, title_key: null },
    ],
    opening: { star_order: ['58', '12'], first_message: { member_id: '58', ts: '2026-01-01T15:00:07Z' }, oyasumi_total: 120 },
    ...over,
});
