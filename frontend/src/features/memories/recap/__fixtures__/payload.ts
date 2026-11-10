import type {
    RecapClip, RecapMessage, RecapOverview, RecapPayload, RecapPoster, RecapSlide, RecapStub, S03ClockData, S04GreetingsData, S05PhotosData,
    S06VoiceData, S07LetterData, S08EchoData, S09SpecialData, S10YouData, S11DaisukiData,
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

export const LETTER_TEXT = '%%%へ\n今年もたくさんありがとう。\nライブで会えた日のこと、ずっと覚えています。\nこれからも一緒に歩いてください。';

export const letterData = (over: Partial<S07LetterData> = {}): S07LetterData => ({
    message: message(30, LETTER_TEXT, { ts: '2026-08-20T13:30:00Z' }),
    char_count: LETTER_TEXT.length,
    photo_url: null,
    ...over,
});

export const echoData = (over: Partial<S08EchoData> = {}): S08EchoData => ({
    then: message(40, '今日は花火を見たよ', { ts: '2025-07-30T12:00:00Z' }),
    now: message(41, '%%%、今年も花火！', { ts: '2026-07-30T12:30:00Z' }),
    shared_keyword: '花火',
    years_apart: 1,
    mode: 'echo',
    ...over,
});

export const stub = (kind: RecapStub['kind'], over: Partial<RecapStub> = {}): RecapStub => ({
    kind,
    message: message(50, `${kind}のことば`, { ts: '2026-03-02T15:00:07Z' }),
    seconds_after_midnight: null,
    sealed: false,
    ...over,
});

export const specialData = (over: Partial<S09SpecialData> = {}): S09SpecialData => ({
    stubs: [
        stub('birthday', { message: message(51, 'お誕生日、ありがとう', { ts: '2026-03-01T15:00:07Z' }), seconds_after_midnight: 7 }),
        { kind: 'christmas', message: null, seconds_after_midnight: null, sealed: true },
        stub('newyear', { message: message(52, 'あけましておめでとう', { ts: '2025-12-31T15:00:03Z' }), seconds_after_midnight: 3 }),
        stub('anniversary', { message: message(53, '今日もおつかれさま', { ts: '2026-07-24T11:00:00Z' }) }),
    ],
    ...over,
});

export const youData = (over: Partial<Extract<S10YouData, { invite: false }>> = {}): S10YouData => ({
    invite: false,
    favorites_count: 12,
    first_favorite: {
        ...message(60, null, { ts: '2026-02-01T10:00:00Z' }),
        favorited_at: '2026-02-03T10:00:00Z',
    },
    letters_count: 2,
    letters: [
        { date: '2026-03-01', first_line: '美玖ちゃんへ' },
        { date: '2026-09-15', first_line: 'お誕生日おめでとう' },
    ],
    ...over,
});

export const daisukiData = (over: Partial<S11DaisukiData> = {}): S11DaisukiData => ({
    petals: [
        { text: '大好きだよ', date: '2026-02-14' },
        { text: '%%%、ありがとう', date: '2026-05-01' },
        { text: 'いつも感謝してます', date: '2026-09-09' },
    ],
    final: message(70, '%%%、大好き。いつもありがとう。', { ts: '2026-11-01T12:00:00Z' }),
    variant: null,
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

export const posterData = (over: Partial<RecapPoster> = {}): RecapPoster => ({
    best_photo: message(20, null, { type: 'picture', media_url: '/api/content/media/best.jpg', caption: '%%%に見せたかった空' }),
    sentence: {
        sentence: '一緒に歩いてくれて、ありがとう。',
        message_id: 3,
        member_path: MEMBER_PATH,
        ts: '2026-06-01T12:00:00Z',
        photo_url: null,
    },
    numbers: [{ key: 'nickname', count: 42 }, { key: 'oyasumi', count: 180 }, { key: 'photos', count: 96 }],
    stubs: [{ kind: 'birthday', message: message(21, 'お誕生日、ありがとう', { ts: '2026-09-02T15:00:07Z' }), seconds_after_midnight: 7, sealed: false }],
    start_mid_recent: [
        message(22, null, { type: 'picture', media_url: '/api/content/media/s.jpg', ts: '2026-01-03T03:00:00Z' }),
        message(23, null, { type: 'picture', media_url: '/api/content/media/m.jpg', ts: '2026-06-03T03:00:00Z' }),
        message(24, null, { type: 'picture', media_url: '/api/content/media/r.jpg', ts: '2026-11-03T03:00:00Z' }),
    ],
    favorites_count: 12,
    letters_count: 3,
    avatar_changed: false,
    avatar_old_url: null,
    avatar_new_url: null,
    years_together: 3,
    ...over,
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
    poster: posterData(),
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
