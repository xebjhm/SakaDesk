import { describe, it, expect } from 'vitest';
import { axisLabel, clockMs, clockSpan, gapRuns, guidePairs, MATCH_WINDOW_MS, type LaneEntry } from './yearLanes';

const H = 60 * 60 * 1000;
const M = 60 * 1000;
const e = (key: string, kind: LaneEntry['kind'], clock: number): LaneEntry => ({ key, kind, clock });

describe('yearLanes', () => {
    it('reads the JST time of day of any year', () => {
        expect(clockMs('2024-09-13T22:10:00Z')).toBe(7 * H + 10 * M);
        expect(clockMs('2025-09-13T22:10:00Z')).toBe(7 * H + 10 * M);
        expect(clockMs('2025-11-01T15:04:00Z')).toBe(4 * M); // 00:04 JST the next day
        expect(clockSpan([7 * H + 10 * M, 23 * H + 30 * M])).toEqual({ startHour: 7, hourCount: 17 });
        expect(clockSpan([])).toEqual({ startHour: 0, hourCount: 1 });
        expect(axisLabel(7)).toBe('07:00');
    });

    it('joins the same kind in neighbouring years within the window, nearest first, once each', () => {
        const lanes = [
            [e('a1', 'ohayo', 7 * H), e('a2', 'photo', 15 * H), e('a3', 'oyasumi', 23 * H), e('a4', null, 12 * H)],
            [e('b1', 'ohayo', 7 * H + 15 * M), e('b2', 'ohayo', 7 * H + 5 * M), e('b3', 'photo', 18 * H), e('b4', 'voice', 23 * H)],
            [e('c1', 'ohayo', 8 * H)],
        ];
        expect(guidePairs(lanes)).toEqual([
            { lane: 0, from: 'a1', to: 'b2' },
            // each lane pair matches on its own: b1 (07:15) is nearer to 08:00 than b2
            { lane: 1, from: 'b1', to: 'c1' },
        ]);
        // photo 15:00 vs 18:00 is past the window; おやすみ never joins a voice
        expect(MATCH_WINDOW_MS).toBe(90 * M);
    });

    it('marks the hours quiet in one year while another year speaks', () => {
        const lanes = [[e('a', 'ohayo', 7 * H), e('b', null, 12 * H)], [e('c', null, 7 * H + 5 * M), e('d', null, 9 * H), e('e', null, 10 * H)]];
        // axis 07:00-13:00 (6 bands): lane 0 is quiet at 09 and 10, lane 1 at 12; 08 and 11 are quiet in both
        expect(gapRuns(lanes, 7, 6)).toEqual([[[2, 3]], [[5, 5]]]);
    });
});
