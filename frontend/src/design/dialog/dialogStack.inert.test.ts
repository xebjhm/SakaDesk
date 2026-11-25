import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { popDialog, pushDialog, resetDialogStack } from './dialogStack';

/** A dialog frame inside its own backdrop, in <body> (as Modal portals it). */
function frame(): HTMLElement {
    const backdrop = document.createElement('div');
    const el = document.createElement('div');
    backdrop.append(el);
    document.body.append(backdrop);
    return el;
}

describe('dialog layer inert background (UI health #15, interim)', () => {
    let root: HTMLElement;
    beforeEach(() => {
        root = document.createElement('div');
        root.id = 'root';
        document.body.append(root);
    });
    afterEach(() => {
        resetDialogStack();
        document.body.innerHTML = '';
    });

    it('makes #root inert while any dialog is open', () => {
        const a = frame();
        const entry = pushDialog({ node: () => a, dismissible: true });
        expect(root).toHaveAttribute('inert');
        expect(a.parentElement).not.toHaveAttribute('inert');
        popDialog(entry);
        expect(root).not.toHaveAttribute('inert');
    });

    it('makes every dialog below the top one inert, and gives it back when the top closes', () => {
        const a = frame();
        const b = frame();
        const first = pushDialog({ node: () => a, dismissible: true });
        const second = pushDialog({ node: () => b, dismissible: true });
        expect(a.parentElement).toHaveAttribute('inert');
        expect(b.parentElement).not.toHaveAttribute('inert');
        popDialog(second);
        expect(a.parentElement).not.toHaveAttribute('inert');
        expect(root).toHaveAttribute('inert');
        popDialog(first);
        expect(root).not.toHaveAttribute('inert');
    });

    it('clears #root on a reset', () => {
        const a = frame();
        pushDialog({ node: () => a, dismissible: true });
        resetDialogStack();
        expect(root).not.toHaveAttribute('inert');
    });

    it('is a no-op without #root', () => {
        root.remove();
        const a = frame();
        const entry = pushDialog({ node: () => a, dismissible: true });
        expect(() => popDialog(entry)).not.toThrow();
    });
});
