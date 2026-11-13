import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf-8');
const block = (() => {
    const start = css.indexOf('@media (forced-colors: active)');
    return start === -1 ? '' : css.slice(start);
})();

describe('forced colours (UI health #6)', () => {
    it('has one forced-colours block', () => {
        expect(css.match(/@media \(forced-colors: active\)/g)).toHaveLength(1);
    });

    it.each([
        '[role="switch"]',
        '[role="switch"][aria-checked="true"]',
        '[aria-pressed="true"]',
        '[aria-current="page"]',
        '[aria-current="true"]',
        '[aria-selected="true"]',
        '.shadow-card',
        '[role="dialog"]:not([data-surface="dark"] *)',
        '::-webkit-scrollbar-thumb',
        '::-webkit-scrollbar-thumb:hover',
        '[data-surface="dark"] ::-webkit-scrollbar-thumb',
        '.sd-call-overlay ::-webkit-scrollbar-thumb:hover',
    ])('styles %s', (selector) => {
        expect(block).toContain(selector);
    });

    it('uses system colours only, and opts out of forcing only for the switch', () => {
        expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
        expect(block.match(/forced-color-adjust: none/g)?.length).toBe(2);
    });
});
