import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clientLog } from '../../utils/clientLog';
import { leavesKeysToControl } from './keyGuard';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeEach(() => vi.mocked(clientLog).mockClear());

const inside = (html: string) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.firstElementChild!.querySelector('button, input') as Element;
};

describe('leavesKeysToControl', () => {
    it.each([
        ['a range', '<div><input type="range"></div>'],
        ['a slider', '<div role="slider"><button></button></div>'],
        ['a tab list', '<div role="tablist"><button></button></div>'],
        ['a menu', '<div role="menu"><button></button></div>'],
    ])('is true inside %s and logs once per viewer', (_n, html) => {
        const ref = { current: false };
        const el = inside(html);
        expect(leavesKeysToControl(el, ref)).toBe(true);
        expect(leavesKeysToControl(el, ref)).toBe(true);
        expect(ref.current).toBe(true);
        expect(clientLog).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('media_playback', { surface: 'viewer', phase: 'keys', outcome: 'left_to_control' });
    });

    it('is false (and silent) on a plain button, a non-element or null', () => {
        const ref = { current: false };
        expect(leavesKeysToControl(inside('<div><button></button></div>'), ref)).toBe(false);
        expect(leavesKeysToControl(document, ref)).toBe(false);
        expect(leavesKeysToControl(null, ref)).toBe(false);
        expect(ref.current).toBe(false);
        expect(clientLog).not.toHaveBeenCalled();
    });
});
