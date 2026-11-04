import { describe, it, expect } from 'vitest';
import { isTimelineProbeView } from './probeRoute';

describe('isTimelineProbeView', () => {
    it('matches only ?view=timeline-probe', () => {
        expect(isTimelineProbeView('?view=timeline-probe')).toBe(true);
        expect(isTimelineProbeView('?view=timeline-probe&initial=5')).toBe(true);
        expect(isTimelineProbeView('?view=design')).toBe(false);
        expect(isTimelineProbeView('')).toBe(false);
    });
});
