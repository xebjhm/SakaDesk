import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { popDialog, pushDialog, resetDialogStack } from './dialogStack';
import { useAnyDialogOpen } from './useAnyDialogOpen';

describe('useAnyDialogOpen', () => {
    afterEach(() => resetDialogStack());

    it('follows the dialog stack', () => {
        const { result } = renderHook(() => useAnyDialogOpen());
        expect(result.current).toBe(false);
        let a!: ReturnType<typeof pushDialog>;
        let b!: ReturnType<typeof pushDialog>;
        act(() => { a = pushDialog({ node: () => null, dismissible: true }); });
        expect(result.current).toBe(true);
        act(() => { b = pushDialog({ node: () => null, dismissible: true }); });
        act(() => popDialog(a));
        expect(result.current).toBe(true);
        act(() => popDialog(b));
        expect(result.current).toBe(false);
    });
});
