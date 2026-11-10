import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';
import {
    MEMORIES_PAGES, MEMORIES_PAGE_CODES, MEMORIES_VIEWS, MEMORIES_TOGGLES, MEMORIES_SKIP_REASONS,
    RECAP_LOAD_TARGETS, RECAP_LOAD_OUTCOMES, RECAP_PLAY_PHASES, RECAP_POSTER_PHASES, RECAP_SHARE_PHASES,
    RECAP_OPENING_PHASES, logMemoriesPage,
} from './memoriesLog';
import { ALBUM_KINDS } from './types';

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
        'memories_toggle.kind': [...ALBUM_KINDS],
        'memories_skip.target': [...MEMORIES_VIEWS],
        'memories_skip.reason': [...MEMORIES_SKIP_REASONS],
        'recap_load.target': [...RECAP_LOAD_TARGETS],
        'recap_load.outcome': [...RECAP_LOAD_OUTCOMES],
        'recap_play.phase': [...RECAP_PLAY_PHASES],
        'recap_poster.phase': [...RECAP_POSTER_PHASES],
        'recap_share.phase': [...RECAP_SHARE_PHASES],
        'recap_opening.phase': [...RECAP_OPENING_PHASES],
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
});
