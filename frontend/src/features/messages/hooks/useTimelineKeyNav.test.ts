import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type React from 'react';
import { useTimelineKeyNav } from './useTimelineKeyNav';

const key = (k: string, repeat = false) => ({ key: k, repeat, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as React.KeyboardEvent;

function setup(callActive: boolean) {
    const jumpTo = vi.fn();
    const { result } = renderHook(() => useTimelineKeyNav(jumpTo, callActive));
    return { handle: result.current, jumpTo };
}

describe('useTimelineKeyNav', () => {
    it('Home jumps to the top', () => {
        const { handle, jumpTo } = setup(false);
        const e = key('Home');
        handle(e);
        expect(jumpTo).toHaveBeenCalledWith({ kind: 'top' });
        expect(e.preventDefault).toHaveBeenCalled();
    });

    it('a repeated Home does not jump but is still prevented', () => {
        const { handle, jumpTo } = setup(false);
        const e = key('Home', true);
        handle(e);
        expect(jumpTo).not.toHaveBeenCalled();
        expect(e.preventDefault).toHaveBeenCalled();
    });

    it('End jumps to the bottom', () => {
        const { handle, jumpTo } = setup(false);
        handle(key('End'));
        expect(jumpTo).toHaveBeenCalledWith({ kind: 'bottom' });
    });

    it('leaves Home and End to a range or a field', () => {
        const jumpTo = vi.fn();
        const { result } = renderHook(() => useTimelineKeyNav(jumpTo, false));
        const slider = document.createElement('input');
        slider.type = 'range';
        const preventDefault = vi.fn();
        result.current({ key: 'Home', repeat: false, target: slider, preventDefault, stopPropagation: vi.fn() } as unknown as React.KeyboardEvent);
        expect(jumpTo).not.toHaveBeenCalled();
        expect(preventDefault).not.toHaveBeenCalled();
    });

    it('leaves PageUp/PageDown alone when no call is active', () => {
        const { handle, jumpTo } = setup(false);
        const e = key('PageUp');
        handle(e);
        expect(jumpTo).not.toHaveBeenCalled();
        expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it.each(['Home', 'End', 'PageUp', 'PageDown'])('%s does not scroll the hidden list during a call', (k) => {
        const { handle, jumpTo } = setup(true);
        const e = key(k);
        handle(e);
        expect(jumpTo).not.toHaveBeenCalled();
        expect(e.preventDefault).toHaveBeenCalled();
    });

    it('ignores other keys during a call', () => {
        const { handle } = setup(true);
        const e = key('Enter');
        handle(e);
        expect(e.preventDefault).not.toHaveBeenCalled();
    });
});
