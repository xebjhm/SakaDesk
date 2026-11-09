import { describe, it, expect } from 'vitest';
import { Z_INDEX } from '../../constants/zIndex';
import { dialogZIndex, interleavedZIndex, nextDialogOrder, popDialog, pushDialog } from './dialogStack';

describe('interleavedZIndex', () => {
    it('sits half a step above the dialogs opened before it and below the ones opened after', () => {
        const before = pushDialog({ node: () => null, dismissible: true });
        const order = nextDialogOrder();
        expect(interleavedZIndex(order)).toBe(Z_INDEX.DIALOG + Z_INDEX.DIALOG_STEP / 2);
        expect(interleavedZIndex(order)).toBeGreaterThan(dialogZIndex(before));

        const after = pushDialog({ node: () => null, dismissible: true });
        expect(dialogZIndex(after)).toBeGreaterThan(interleavedZIndex(order));

        popDialog(before);
        expect(interleavedZIndex(order)).toBe(Z_INDEX.DIALOG - Z_INDEX.DIALOG_STEP / 2);
        expect(dialogZIndex(after)).toBeGreaterThan(interleavedZIndex(order));
        expect(interleavedZIndex(order)).toBeLessThan(Z_INDEX.POPOVER);
    });
});
