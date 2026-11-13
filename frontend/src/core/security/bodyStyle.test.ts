import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// pywebview used to inject `body{user-select:none; cursor:default}` as an inline <style>, which
// the app CSP (style-src 'self') refuses. Both windows now pass text_select=True, so the rule
// must live in the app's own stylesheet.
describe('index.css body rule', () => {
    it('keeps the body unselectable with the default cursor', () => {
        const css = readFileSync(path.resolve(__dirname, '../../index.css'), 'utf-8');
        const body = /(?:^|\n)\s*body\s*\{([^}]*)\}/.exec(css);
        expect(body).not.toBeNull();
        expect(body![1]).toMatch(/user-select:\s*none/);
        expect(body![1]).toMatch(/cursor:\s*default/);
    });
});
