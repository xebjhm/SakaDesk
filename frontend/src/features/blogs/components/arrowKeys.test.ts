import { describe, it, expect, afterEach } from 'vitest';
import { ignoresPostKeys } from './arrowKeys';

afterEach(() => { document.body.innerHTML = ''; });

const key = (target: EventTarget = document.body) => {
    const e = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    Object.defineProperty(e, 'target', { value: target });
    return e;
};

describe('ignoresPostKeys', () => {
    it('lets a plain arrow key through', () => {
        expect(ignoresPostKeys(key())).toBe(false);
    });

    it('ignores every arrow while any aria-modal dialog is open, even without focus', () => {
        document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
        expect(ignoresPostKeys(key())).toBe(true);
    });

    it('ignores keys typed in a text field', () => {
        document.body.innerHTML = '<input id="i" />';
        expect(ignoresPostKeys(key(document.getElementById('i')!))).toBe(true);
    });
});
