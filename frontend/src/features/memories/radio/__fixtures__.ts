import { memoryMessage, MEMBER_PATH } from '../__fixtures__/memories';
import type {
    RadioCassettesPayload, RadioMember, RadioMembersPayload, RadioProgramPayload, RadioTrack,
} from '../types';

export { MEMBER_PATH };
export const NAO_PATH = '日向坂46/messages/12 小坂 菜緒/40 小坂 菜緒';

export function radioMember(over: Partial<RadioMember> = {}): RadioMember {
    return {
        member_path: MEMBER_PATH,
        member_id: '34',
        name: '金村 美玖',
        avatar_url: null,
        oshi: true,
        voices: 214,
        seconds: 3 * 3600 + 12 * 60,
        ...over,
    };
}

export function radioMembersPayload(over: Partial<RadioMembersPayload> = {}): RadioMembersPayload {
    return {
        total_seconds: 4 * 3600,
        members: [
            radioMember(),
            radioMember({ member_path: NAO_PATH, member_id: '12', name: '小坂 菜緒', oshi: false, voices: 98, seconds: 42 * 60 }),
        ],
        ...over,
    };
}

/** A whole-voice track (message `id`, a voice file, 42 s). */
export function radioTrack(id: number, over: Partial<RadioTrack> = {}): RadioTrack {
    return {
        message: memoryMessage({
            id,
            type: 'voice',
            text: null,
            ts: '2024-09-22T14:41:00Z',
            media_url: `/api/media/hinatazaka46/voice/${id}.m4a`,
            media_file: `voice/${id}.m4a`,
            duration_s: 42,
            avatar_url: '/api/media/hinatazaka46/avatar/miku.jpg',
        }),
        start: 0,
        end: 42,
        has_transcript: false,
        segments: null,
        ...over,
    };
}

export function radioProgramPayload(over: Partial<RadioProgramPayload> = {}): RadioProgramPayload {
    return {
        program: 'oyasumi',
        programs: ['oyasumi', 'ohayo', 'otsukare', 'chrono', 'favorites'],
        counts: { oyasumi: 3, ohayo: 12, otsukare: 7, chrono: 41, favorites: 1 },
        years: [2023, 2024],
        tracks: [radioTrack(1), radioTrack(2), radioTrack(3)],
        ...over,
    };
}

/**
 * Three tapes, oldest first; `colors` are the years' probe colours (tests pass literals: this file
 * is scanned by the design guard), null for none.
 */
export function cassettesPayload(colors: Array<string | null> = [null, null, null]): RadioCassettesPayload {
    return {
        cassettes: [
            { year: 2023, voices: 41, seconds: 32 * 60, color: colors[0] ?? null },
            { year: 2024, voices: 96, seconds: 85 * 60, color: colors[1] ?? null },
            { year: 2025, voices: 77, seconds: 75 * 60, color: colors[2] ?? null },
        ],
    };
}
