import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type React from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import { useTimelineKeyNav } from './useTimelineKeyNav';

const key = (k: string) => ({ key: k, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as React.KeyboardEvent;

function setup(callActive: boolean, length = 5) {
    const scrollToIndex = vi.fn();
    const ref = { current: { scrollToIndex } as unknown as VirtuosoHandle };
    const { result } = renderHook(() => useTimelineKeyNav(ref, length, callActive));
    return { handle: result.current, scrollToIndex };
}

describe('useTimelineKeyNav', () => {
    it('Home scrolls to the first message', () => {
        const { handle, scrollToIndex } = setup(false);
        const e = key('Home');
        handle(e);
        expect(scrollToIndex).toHaveBeenCalledWith({ index: 0, behavior: 'auto' });
        expect(e.preventDefault).toHaveBeenCalled();
    });

    it('End scrolls to the last message', () => {
        const { handle, scrollToIndex } = setup(false, 7);
        handle(key('End'));
        expect(scrollToIndex).toHaveBeenCalledWith({ index: 6, behavior: 'auto' });
    });

    it('leaves PageUp/PageDown alone when no call is active', () => {
        const { handle, scrollToIndex } = setup(false);
        const e = key('PageUp');
        handle(e);
        expect(scrollToIndex).not.toHaveBeenCalled();
        expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it.each(['Home', 'End', 'PageUp', 'PageDown'])('%s does not scroll the hidden list during a call', (k) => {
        const { handle, scrollToIndex } = setup(true);
        const e = key(k);
        handle(e);
        expect(scrollToIndex).not.toHaveBeenCalled();
        expect(e.preventDefault).toHaveBeenCalled();
    });

    it('ignores other keys during a call', () => {
        const { handle } = setup(true);
        const e = key('Enter');
        handle(e);
        expect(e.preventDefault).not.toHaveBeenCalled();
    });
});
