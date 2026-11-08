import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAvatarWidth } from './useAvatarWidth';

describe('useAvatarWidth', () => {
    const original = window.devicePixelRatio;
    afterEach(() => Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value: original }));

    it('picks the allowed width for the drawn size at the screen density', () => {
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value: 1.75 });
        expect(renderHook(() => useAvatarWidth(64)).result.current).toBe(112);
        expect(renderHook(() => useAvatarWidth(40)).result.current).toBe(80);
    });
});
