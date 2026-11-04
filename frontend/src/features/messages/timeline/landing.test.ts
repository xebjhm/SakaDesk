import { describe, it, expect, afterEach } from 'vitest';
import { landingError, measureLanding, stickyHeaderBottom, topVisibleRowIndex, LANDING_TOLERANCE_PX } from './landing';

const view = { top: 100, bottom: 700 };
const free = { atTop: false, atBottom: false };

describe('landingError', () => {
    it('start: distance of the row top from the view top', () => {
        expect(landingError({ top: 130, bottom: 180 }, view, free, 'start')).toBe(30);
        expect(landingError({ top: 100, bottom: 180 }, view, free, 'start')).toBe(0);
    });

    it('start: a row below the top is fine when the list cannot scroll further', () => {
        expect(landingError({ top: 400, bottom: 450 }, view, { atTop: false, atBottom: true }, 'start')).toBe(0);
    });

    it('center: distance of the row centre from the view centre', () => {
        expect(landingError({ top: 375, bottom: 425 }, view, free, 'center')).toBe(0);
        expect(landingError({ top: 200, bottom: 250 }, view, free, 'center')).toBe(-175);
    });

    it('center: clamped at either end of the list', () => {
        expect(landingError({ top: 200, bottom: 250 }, view, { atTop: true, atBottom: false }, 'center')).toBe(0);
        expect(landingError({ top: 600, bottom: 650 }, view, { atTop: false, atBottom: true }, 'center')).toBe(0);
    });

    it('end: distance of the row bottom from the view bottom, clamped at the top', () => {
        expect(landingError({ top: 600, bottom: 690 }, view, free, 'end')).toBe(-10);
        expect(landingError({ top: 120, bottom: 300 }, view, { atTop: true, atBottom: false }, 'end')).toBe(0);
    });

    it('exports an 8 px tolerance', () => {
        expect(LANDING_TOLERANCE_PX).toBe(8);
    });
});

describe('DOM measurement', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    /** A scroller (top 100) with rows `msg-1..3` at the given tops (50 px tall) and an optional sticky header. */
    function mount(rowTops: number[], headerBottom?: number) {
        const header = headerBottom === undefined ? '' : '<div data-testid="virtuoso-top-item-list" id="h"></div>';
        const rows = rowTops.map((_, i) => `<div id="msg-${i + 1}"></div>`).join('');
        document.body.innerHTML = `<div data-virtuoso-scroller="true" id="s">${header}${rows}</div>`;
        const s = document.getElementById('s')!;
        s.getBoundingClientRect = () => ({ top: 100, bottom: 700 } as DOMRect);
        Object.defineProperties(s, {
            scrollTop: { value: 500, configurable: true },
            clientHeight: { value: 600, configurable: true },
            scrollHeight: { value: 5000, configurable: true },
        });
        if (headerBottom !== undefined) {
            document.getElementById('h')!.getBoundingClientRect = () => ({ top: 100, bottom: headerBottom, height: headerBottom - 100 } as DOMRect);
        }
        rowTops.forEach((top, i) => {
            document.getElementById(`msg-${i + 1}`)!.getBoundingClientRect = () => ({ top, bottom: top + 50 } as DOMRect);
        });
        return s;
    }

    it('measureLanding returns null when the row is not rendered', () => {
        expect(measureLanding('msg-42', 'start')).toBeNull();
    });

    it('measureLanding measures the rendered row against its scroller', () => {
        mount([112]);
        expect(measureLanding('msg-1', 'start')).toBe(12);
    });

    it('start lands below the sticky header; center ignores it', () => {
        mount([152], 140);
        expect(stickyHeaderBottom(document.getElementById('s')!)).toBe(140);
        expect(measureLanding('msg-1', 'start')).toBe(12);
        expect(measureLanding('msg-1', 'center')).toBe(152 + 25 - 400);
    });

    it('topVisibleRowIndex skips rows hidden behind the sticky header', () => {
        const s = mount([90, 140, 190], 140);
        const keyAt = (i: number) => (i < 3 ? (`msg-${i + 1}` as const) : null);
        expect(topVisibleRowIndex(s, { startIndex: 0, endIndex: 2 }, keyAt)).toBe(1);
    });

    it('topVisibleRowIndex falls back to the range start', () => {
        expect(topVisibleRowIndex(null, { startIndex: 4, endIndex: 9 }, () => null)).toBe(4);
        const s = mount([]);
        expect(topVisibleRowIndex(s, { startIndex: 2, endIndex: 3 }, () => 'msg-9')).toBe(2);
    });
});
