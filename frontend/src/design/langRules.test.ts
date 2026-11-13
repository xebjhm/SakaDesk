import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf-8');

describe('content in another language keeps its glyphs (UI health #10)', () => {
    it.each([
        ['ja', 'ja'], ['zh-TW', 'zh-tw'], ['zh-CN', 'zh-cn'], ['yue', 'yue'], ['en', 'en'],
    ])('[lang="%s"] uses the %s stack variables', (lang, key) => {
        const rule = css.slice(css.indexOf(`[lang="${lang}"]:not(html) {`));
        expect(rule.slice(0, rule.indexOf('}'))).toContain(`var(--ds-font-sans-${key})`);
    });

    it('no longer copies the Japanese stack literally', () => {
        expect(css).not.toContain('"Noto Sans JP Variable", system-ui');
    });

    it('keeps the display and reading faces on marked elements in every content language', () => {
        const marked = ':is([lang="ja"], [lang="zh-TW"], [lang="zh-CN"], [lang="yue"], [lang="en"]):not(html)';
        expect(css).toContain(`${marked}.font-reading {`);
        expect(css).toContain(`${marked}.font-display {`);
        expect(css).not.toContain('[lang="ja"]:not(html).font-display');
    });
});
