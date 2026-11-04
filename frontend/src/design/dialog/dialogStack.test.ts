import { describe, it, expect, beforeEach } from 'vitest';
import { Z_INDEX } from '../../constants/zIndex';
import { dialogZIndex, isTopDialog, openDialogCount, popDialog, pushDialog, resetDialogStack } from './dialogStack';

const entry = () => ({ node: () => null, dismissible: true });

beforeEach(() => {
    resetDialogStack();
    document.body.style.overflow = 'auto';
});

describe('dialogStack', () => {
    it('tracks the top-most dialog and its z-index by depth', () => {
        const a = pushDialog(entry());
        const b = pushDialog(entry());
        expect(isTopDialog(a)).toBe(false);
        expect(isTopDialog(b)).toBe(true);
        expect(dialogZIndex(a)).toBe(Z_INDEX.DIALOG);
        expect(dialogZIndex(b)).toBe(Z_INDEX.DIALOG + Z_INDEX.DIALOG_STEP);
        popDialog(b);
        expect(isTopDialog(a)).toBe(true);
        expect(openDialogCount()).toBe(1);
    });

    it('pops an entry from the middle', () => {
        const a = pushDialog(entry());
        const b = pushDialog(entry());
        const c = pushDialog(entry());
        popDialog(b);
        expect(isTopDialog(c)).toBe(true);
        expect(dialogZIndex(c)).toBe(Z_INDEX.DIALOG + Z_INDEX.DIALOG_STEP);
        popDialog(a);
        popDialog(c);
        expect(openDialogCount()).toBe(0);
    });

    it('locks body scroll while any dialog is open and restores the previous value', () => {
        const a = pushDialog(entry());
        expect(document.body.style.overflow).toBe('hidden');
        const b = pushDialog(entry());
        popDialog(a);
        expect(document.body.style.overflow).toBe('hidden');
        popDialog(b);
        expect(document.body.style.overflow).toBe('auto');
    });

    it('popping twice is harmless', () => {
        const a = pushDialog(entry());
        popDialog(a);
        popDialog(a);
        expect(openDialogCount()).toBe(0);
        expect(document.body.style.overflow).toBe('auto');
    });

    it('a popped entry is never top-most and an empty stack has no top', () => {
        const a = pushDialog(entry());
        popDialog(a);
        expect(isTopDialog(a)).toBe(false);
        expect(openDialogCount()).toBe(0);
    });

    it('re-locks after the stack empties and restores the value seen at that time', () => {
        const a = pushDialog(entry());
        popDialog(a);
        document.body.style.overflow = 'scroll';
        const b = pushDialog(entry());
        expect(document.body.style.overflow).toBe('hidden');
        popDialog(b);
        expect(document.body.style.overflow).toBe('scroll');
    });

    it('gives each entry a distinct id', () => {
        const a = pushDialog(entry());
        const b = pushDialog(entry());
        expect(a.id).not.toBe(b.id);
    });

    it('reset unlocks scroll and forgets every dialog', () => {
        pushDialog(entry());
        pushDialog(entry());
        resetDialogStack();
        expect(openDialogCount()).toBe(0);
        expect(document.body.style.overflow).toBe('auto');
    });
});
