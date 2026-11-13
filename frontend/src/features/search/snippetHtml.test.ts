import { describe, it, expect } from 'vitest';
import { escapeHtml, fillNickname, snippetMarks } from './snippetHtml';

describe('snippetMarks', () => {
    it('reads mark texts and reading marks from the parsed snippet', () => {
        expect(snippetMarks('<mark>おはよう</mark> <mark class="reading">朝</mark>')).toEqual({
            matched: ['おはよう', '朝'],
            reading: ['朝'],
        });
    });
    it('never counts escaped markup in the archived text as a mark', () => {
        expect(snippetMarks('&lt;mark&gt;XSSTERM&lt;/mark&gt; <mark>桜</mark>').matched).toEqual(['桜']);
    });
    it('decodes entities in a mark', () => {
        expect(snippetMarks('<mark>a&amp;b</mark>').matched).toEqual(['a&b']);
    });
    it('reads adjacent marks separately', () => {
        expect(snippetMarks('<mark>日向</mark><mark>坂</mark>').matched).toEqual(['日向', '坂']);
    });
    it('keeps CJK and emoji in a mark intact', () => {
        expect(snippetMarks('前 <mark>桜🌸ひな</mark> 後').matched).toEqual(['桜🌸ひな']);
    });
    it('is empty for an empty snippet', () => {
        expect(snippetMarks('')).toEqual({ matched: [], reading: [] });
    });
});

describe('fillNickname', () => {
    it('inserts the nickname as text', () => {
        expect(fillNickname('%%%さん ％％％', '<img src=x onerror=1>')).toBe(
            '&lt;img src=x onerror=1&gt;さん &lt;img src=x onerror=1&gt;',
        );
    });
    it('inserts a CJK and emoji nickname as text', () => {
        expect(fillNickname('%%%さん', 'みく🐰<b>')).toBe('みく🐰&lt;b&gt;さん');
    });
    it('keeps replacement patterns in a nickname literal', () => {
        expect(fillNickname('%%%', "$& $1 '\"")).toBe('$&amp; $1 &#39;&quot;');
    });
    it('escapes the five HTML-significant characters', () => {
        expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    });
});
