import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';
import {
    MEMORIES_PAGES, MEMORIES_PAGE_CODES, MEMORIES_VIEWS, MEMORIES_TOGGLES, MEMORIES_SKIP_REASONS, MEMORIES_TOGGLE_REASONS,
    RECAP_LOAD_TARGETS, RECAP_LOAD_OUTCOMES, RECAP_PLAY_PHASES, RECAP_POSTER_PHASES, RECAP_SHARE_PHASES,
    RECAP_OPENING_PHASES, logMemoriesPage,
    MEMORIES_RADIO_PHASES, MEMORIES_RADIO_REASONS, MEMORIES_RADIO_OUTCOMES,
    MEMORIES_GACHA_PHASES, MEMORIES_GACHA_REFUSALS, MEMORIES_GACHA_OUTCOMES,
    MEMORIES_CAPSULE_PHASES, MEMORIES_CAPSULE_OUTCOMES, MEMORIES_CAPSULE_ERROR_CODES,
    logMemoriesRadio, logMemoriesGacha, logMemoriesCapsule,
    NOTIFY_OPEN_MEMORIES_PAGES, NOTIFY_OPEN_MEMORIES_REASONS,
} from './memoriesLog';
import { ALBUM_KINDS, CAPSULE_ANCHOR_KINDS, GACHA_RARITIES, GACHA_REASONS, RADIO_PROGRAMS } from './types';

/** The backend posts every value in this fixture (`test_client_log_api.py`). */
const FIXTURE = resolve(__dirname, '../../../../backend/tests/fixtures/memories_log_codes.json');
const CODE = /^[a-z0-9_]{1,40}$/;

/** Every code value the Memories and recap breadcrumbs can send, keyed `event.field`. */
function emitted(): Record<string, string[]> {
    return {
        'memories_page.target': MEMORIES_PAGES.map((p) => MEMORIES_PAGE_CODES[p]),
        'memories_load.target': [...MEMORIES_VIEWS],
        'memories_load.outcome': ['ok', 'error', 'timeout'],
        'memories_jump.target': [...MEMORIES_VIEWS],
        'memories_toggle.target': [...MEMORIES_TOGGLES],
        'memories_toggle.outcome': ['on', 'off'],
        'memories_toggle.kind': [...ALBUM_KINDS, ...RADIO_PROGRAMS],
        'memories_toggle.reason': [...MEMORIES_TOGGLE_REASONS],
        'memories_skip.target': [...MEMORIES_VIEWS],
        'memories_skip.reason': [...MEMORIES_SKIP_REASONS],
        'memories_radio.phase': [...MEMORIES_RADIO_PHASES],
        'memories_radio.kind': [...RADIO_PROGRAMS],
        'memories_radio.reason': [...MEMORIES_RADIO_REASONS],
        'memories_radio.outcome': [...MEMORIES_RADIO_OUTCOMES],
        'memories_gacha.phase': [...MEMORIES_GACHA_PHASES],
        'memories_gacha.kind': [...GACHA_RARITIES],
        'memories_gacha.reason': [...GACHA_REASONS, ...MEMORIES_GACHA_REFUSALS],
        'memories_gacha.outcome': [...MEMORIES_GACHA_OUTCOMES],
        'memories_capsule.phase': [...MEMORIES_CAPSULE_PHASES],
        'memories_capsule.kind': [...CAPSULE_ANCHOR_KINDS],
        'memories_capsule.outcome': [...MEMORIES_CAPSULE_OUTCOMES],
        'memories_capsule.error_code': [...MEMORIES_CAPSULE_ERROR_CODES],
        'recap_load.target': [...RECAP_LOAD_TARGETS],
        'recap_load.outcome': [...RECAP_LOAD_OUTCOMES],
        'recap_play.phase': [...RECAP_PLAY_PHASES],
        'recap_poster.phase': [...RECAP_POSTER_PHASES],
        'recap_share.phase': [...RECAP_SHARE_PHASES],
        'recap_opening.phase': [...RECAP_OPENING_PHASES],
        'notify_open_memories.target': NOTIFY_OPEN_MEMORIES_PAGES.map((p) => MEMORIES_PAGE_CODES[p]),
        'notify_open_memories.reason': [...NOTIFY_OPEN_MEMORIES_REASONS],
    };
}

describe('memoriesLog codes', () => {
    beforeEach(() => { vi.mocked(clientLog).mockClear(); });

    it('matches the fixture the backend allowlist test posts', () => {
        const fixture = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as Record<string, string[]>;
        expect(fixture).toEqual(emitted());
    });

    it('only emits values the backend code pattern accepts', () => {
        for (const [field, values] of Object.entries(emitted())) {
            for (const value of values) expect({ field, value: CODE.test(value) }).toEqual({ field, value: true });
        }
    });

    it('logs On This Day as a snake_case page code', () => {
        logMemoriesPage('onThisDay');
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_page', { target: 'on_this_day' });
    });

    it('adds the fun-wave pages, views, toggles and skip reasons', () => {
        expect(MEMORIES_PAGES).toEqual(expect.arrayContaining(['radio', 'gacha', 'calendar', 'day']));
        expect(['radio', 'gacha', 'calendar', 'day'].map((p) => MEMORIES_PAGE_CODES[p as keyof typeof MEMORIES_PAGE_CODES]))
            .toEqual(['radio', 'gacha', 'calendar', 'day']);
        expect(MEMORIES_VIEWS).toEqual(expect.arrayContaining([
            'radio', 'radio_members', 'radio_program', 'radio_cassettes', 'gacha', 'calendar', 'calendar_months',
            'capsule', 'capsule_due', 'same_time', 'day24', 'then_now',
        ]));
        expect(MEMORIES_TOGGLES).toEqual(expect.arrayContaining([
            'radio_program', 'cassette', 'sleep_timer', 'then_now', 'calendar_member', 'album_cover',
        ]));
        // r4: the あの日と今日 day / first-week mode pills are gone
        expect(MEMORIES_TOGGLES).not.toContain('then_now_mode');
        // r4 B1: the day view's 歷年同一天 mode
        expect(MEMORIES_VIEWS).toContain('day_years');
        expect(MEMORIES_TOGGLES).toContain('day_years');
        expect(NOTIFY_OPEN_MEMORIES_PAGES.map((p) => MEMORIES_PAGE_CODES[p])).toEqual(['on_this_day', 'memoir', 'recap']);
        expect(NOTIFY_OPEN_MEMORIES_REASONS).toEqual(['malformed', 'unknown_service', 'onboarding']);
        expect(MEMORIES_SKIP_REASONS).toContain('card_missing');
        expect(MEMORIES_SKIP_REASONS).toEqual(expect.arrayContaining([
            'transcript_missing', 'pull_missing', 'day24_thin', 'note_empty', 'same_time_none',
        ]));
        expect(MEMORIES_RADIO_PHASES).toEqual(['play', 'track', 'track_error', 'pause', 'resume', 'sleep_set', 'sleep_fade', 'end']);
        expect(MEMORIES_GACHA_PHASES).toEqual(['open', 'pull', 'reveal', 'refused', 'favorite', 'context']);
        expect(MEMORIES_CAPSULE_PHASES).toEqual(['open', 'save', 'delete', 'failed', 'resurface_open']);
    });

    it('logs the radio, gacha and capsule events with their phase and fields', () => {
        logMemoriesRadio('track', { kind: 'oyasumi', index: 2, count: 9 });
        expect(vi.mocked(clientLog)).toHaveBeenLastCalledWith('memories_radio', { phase: 'track', kind: 'oyasumi', index: 2, count: 9 });
        logMemoriesRadio('track_error', { kind: 'chrono', index: 0, reason: 'media_error' });
        expect(vi.mocked(clientLog)).toHaveBeenLastCalledWith('memories_radio', { phase: 'track_error', kind: 'chrono', index: 0, reason: 'media_error' });
        logMemoriesGacha('reveal', { kind: 'sr', reason: 'midnight', index: 1, message_id: 42 });
        expect(vi.mocked(clientLog)).toHaveBeenLastCalledWith('memories_gacha', { phase: 'reveal', kind: 'sr', reason: 'midnight', index: 1, message_id: 42 });
        logMemoriesGacha('refused', { reason: 'no_pulls_left' });
        expect(vi.mocked(clientLog)).toHaveBeenLastCalledWith('memories_gacha', { phase: 'refused', reason: 'no_pulls_left' });
        logMemoriesCapsule('save', { kind: 'card', outcome: 'created', count: 1 });
        expect(vi.mocked(clientLog)).toHaveBeenLastCalledWith('memories_capsule', { phase: 'save', kind: 'card', outcome: 'created', count: 1 });
        logMemoriesCapsule('failed', { kind: 'day', error_code: 'bad_note' });
        expect(vi.mocked(clientLog)).toHaveBeenLastCalledWith('memories_capsule', { phase: 'failed', kind: 'day', error_code: 'bad_note' });
    });

    it('gives the capsule logger no field that could carry the note body', () => {
        // @ts-expect-error the body (the fan's own words) is never a log field
        logMemoriesCapsule('save', { body: 'x' });
        // @ts-expect-error nor any free text
        logMemoriesCapsule('save', { text: 'x' });
        expect(true).toBe(true);
    });
});
