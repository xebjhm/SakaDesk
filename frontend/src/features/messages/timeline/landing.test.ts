import { describe, it, expect, afterEach } from 'vitest';
import { landingError, measureLanding, LANDING_TOLERANCE_PX } from './landing';

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

describe('measureLanding', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    function mount(rowTop: number) {
        document.body.innerHTML =
            '<div data-virtuoso-scroller="true" id="s"><div id="msg-42"></div></div>';
        const s = document.getElementById('s')!;
        const r = document.getElementById('msg-42')!;
        s.getBoundingClientRect = () => ({ top: 100, bottom: 700 } as DOMRect);
        r.getBoundingClientRect = () => ({ top: rowTop, bottom: rowTop + 50 } as DOMRect);
        Object.defineProperties(s, {
            scrollTop: { value: 500, configurable: true },
            clientHeight: { value: 600, configurable: true },
            scrollHeight: { value: 5000, configurable: true },
        });
    }

    it('returns null when the row is not rendered', () => {
        expect(measureLanding(42, 'start')).toBeNull();
    });

    it('measures the rendered row against its scroller', () => {
        mount(112);
        expect(measureLanding(42, 'start')).toBe(12);
    });
});
