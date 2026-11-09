import type {
    RecapClip, RecapMessage, RecapOverview, RecapPayload, RecapSlide, S03ClockData, S04GreetingsData, S05PhotosData,
    S06VoiceData,
} from '../api';

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

export const clockData = (over: Partial<S03ClockData> = {}): S03ClockData => ({
    stars: [
        { h: 22, m: 10, type: 'text' }, { h: 22, m: 40, type: 'picture' }, { h: 22, m: 55, type: 'voice' },
        { h: 7, m: 5, type: 'text' }, { h: 13, m: 30, type: 'text' },
    ],
    peak_hour: 22,
    representative: message(5, '%%%、今日もおつかれさま'),
    longest_streak: 12,
    ...over,
});

export const greetingsData = (over: Partial<S04GreetingsData> = {}): S04GreetingsData => ({
    first_ohayo: message(6, 'おはよう、%%%'),
    latest_oyasumi: message(7, 'おやすみ🌙'),
    oyasumi_count: 180,
    distinct_days: 150,
    variant: 'oyasumi',
    ...over,
});

const burstAt = (id: number, ts: string, type: RecapMessage['type'] = 'picture') =>
    message(id, null, { type, ts, media_url: `/api/media/b${id}.jpg` });

export const photosData = (over: Partial<S05PhotosData> = {}): S05PhotosData => ({
    burst: [
        burstAt(10, '2026-05-03T09:00:00Z'), burstAt(11, '2026-05-03T09:00:20Z'),
        burstAt(12, '2026-05-03T09:01:00Z'), burstAt(13, '2026-05-03T09:03:00Z', 'video'),
    ],
    burst_caption: '%%%に見せたかった海',
    wall: ['/api/media/w1.jpg', null, '/api/media/w2.jpg', '/api/media/w3.jpg', '/api/media/w4.jpg'],
    mostly_bursts: false,
    ...over,
});

export const clip = (id: number, over: Partial<RecapClip> = {}): RecapClip => ({
    message: message(id, null, { type: 'voice', media_url: `/api/media/v${id}.m4a` }),
    start: 0,
    end: 6,
    transcript_segments: null,
    ...over,
});

export const voiceData = (over: Partial<S06VoiceData> = {}): S06VoiceData => ({
    clips: [
        clip(20, { transcript_segments: [{ start: 0, end: 3, text: '%%%、聞こえる？' }] }),
        clip(21),
        clip(22),
    ],
    voice_count: 24,
    ...over,
});

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
