import { describe, it, expect, beforeEach } from 'vitest';
import { Z_INDEX } from '../../constants/zIndex';
import {
    dialogAbove, dialogZIndex, isTopDialog, nextDialogOrder, openDialogCount, popDialog, pushDialog, resetDialogStack,
    subscribeDialogStack,
} from './dialogStack';

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

    it('inserts by order: a parent pushed after its child (same render) goes below it', () => {
        const parentOrder = nextDialogOrder();
        const childOrder = nextDialogOrder();
        const child = pushDialog({ ...entry(), order: childOrder });
        const parent = pushDialog({ ...entry(), order: parentOrder });
        expect(isTopDialog(child)).toBe(true);
        expect(isTopDialog(parent)).toBe(false);
        expect(dialogZIndex(parent)).toBe(Z_INDEX.DIALOG);
        expect(dialogZIndex(child)).toBe(Z_INDEX.DIALOG + Z_INDEX.DIALOG_STEP);
        expect(dialogAbove(parent)).toBe(child);
        expect(dialogAbove(child)).toBeNull();
    });

    it('an entry without an order goes on top of every ordered one', () => {
        const a = pushDialog({ ...entry(), order: nextDialogOrder() });
        const b = pushDialog(entry());
        expect(isTopDialog(b)).toBe(true);
        expect(dialogAbove(a)).toBe(b);
    });

    it('equal orders keep push order', () => {
        const a = pushDialog({ ...entry(), order: 5 });
        const b = pushDialog({ ...entry(), order: 5 });
        expect(isTopDialog(b)).toBe(true);
        expect(dialogAbove(a)).toBe(b);
    });

    it('notifies subscribers on push, pop and reset, until they unsubscribe', () => {
        const seen: number[] = [];
        const off = subscribeDialogStack(() => seen.push(openDialogCount()));
        const a = pushDialog(entry());
        const b = pushDialog(entry());
        popDialog(a);
        popDialog(a); // not in the stack: no change, no notification
        resetDialogStack();
        off();
        pushDialog(entry());
        expect(seen).toEqual([1, 2, 1, 0]);
        expect(isTopDialog(b)).toBe(false);
    });

    it('remembers where focus returns, and the entry may hand it on', () => {
        const opener = document.createElement('button');
        const a = pushDialog({ ...entry(), restoreTo: opener });
        expect(a.restoreTo).toBe(opener);
        a.restoreTo = null;
        expect(a.restoreTo).toBeNull();
        expect(pushDialog(entry()).restoreTo).toBeNull();
    });
});
