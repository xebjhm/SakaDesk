import { describe, it, expect } from 'vitest';
import {
    buildBlogFragment, highlightKey, highlightTextNodes, normalizeBlogUrls, parseHighlightKey,
    splitHighlightTerms, EXACT_MARK_CLASS, READING_MARK_CLASS,
} from './blogHtml';

const NONE = { exact: [] as string[], reading: [] as string[] };
const BASE = 'https://www.hinatazaka46.com';

function serialize(fragment: DocumentFragment): string {
    const box = document.createElement('div');
    box.append(fragment.cloneNode(true));
    return box.innerHTML;
}

describe('normalizeBlogUrls', () => {
    it('keeps cached blog images local', () => {
        const html = '<img src="/api/blogs/image?service=hinatazaka46&amp;blog_id=1&amp;filename=img_0.jpg">';
        expect(normalizeBlogUrls(html, BASE)).toBe(html);
    });
    it('points every other root-relative URL, /api/ included, at the blog host', () => {
        expect(normalizeBlogUrls('<a href="/api/settings">x</a>', BASE)).toBe(`<a href="${BASE}/api/settings">x</a>`);
        expect(normalizeBlogUrls('<img src="/api/content/media/x.html">', BASE)).toBe(`<img src="${BASE}/api/content/media/x.html">`);
        expect(normalizeBlogUrls('<a href="/s/official/diary/1">x</a>', BASE)).toBe(`<a href="${BASE}/s/official/diary/1">x</a>`);
    });
    it('completes protocol-relative and relative URLs and keeps absolute ones', () => {
        expect(normalizeBlogUrls('<img src="//cdn.hinatazaka46.com/a.jpg">', BASE)).toBe('<img src="https://cdn.hinatazaka46.com/a.jpg">');
        expect(normalizeBlogUrls("<img src='a.jpg'>", BASE)).toBe(`<img src='${BASE}/a.jpg'>`);
        expect(normalizeBlogUrls('<a href="https://example.com/x">x</a>', BASE)).toBe('<a href="https://example.com/x">x</a>');
    });
    it('leaves the HTML alone without a base URL', () => {
        expect(normalizeBlogUrls('<a href="/x">x</a>', '')).toBe('<a href="/x">x</a>');
    });
});

describe('buildBlogFragment', () => {
    it('drops scripts and event handlers', () => {
        const fragment = buildBlogFragment('<p onclick="x()">hi<script>x()</script><img src="a.jpg" onerror="x()"></p>', NONE);
        expect(serialize(fragment)).toBe('<p>hi<img src="a.jpg"></p>');
    });
    it('marks terms only in text, never in attribute values', () => {
        const fragment = buildBlogFragment('<p>桜 <img alt="桜&quot;&gt;&lt;b&gt;" src="a.jpg"></p>', { exact: ['桜'], reading: [] });
        const marks = fragment.querySelectorAll('mark');
        expect(marks).toHaveLength(1);
        expect(marks[0].className).toBe(EXACT_MARK_CLASS);
        expect(fragment.querySelector('img')!.getAttribute('alt')).toBe('桜"><b>');
        expect(fragment.querySelector('b')).toBeNull();
    });
    it('marks reading terms with the reading class, case-insensitively', () => {
        const fragment = buildBlogFragment('<p>Sakura はる</p>', { exact: ['sakura'], reading: ['はる'] });
        expect(Array.from(fragment.querySelectorAll('mark')).map((m) => [m.textContent, m.className])).toEqual([
            ['Sakura', EXACT_MARK_CLASS],
            ['はる', READING_MARK_CLASS],
        ]);
    });
    it('treats regex characters in a term literally', () => {
        const fragment = buildBlogFragment('<p>a.b axb (c)</p>', { exact: ['a.b', '(c)'], reading: [] });
        expect(Array.from(fragment.querySelectorAll('mark')).map((m) => m.textContent)).toEqual(['a.b', '(c)']);
    });
    it('keeps escaped markup in the post as text', () => {
        const fragment = buildBlogFragment('<p>&lt;mark&gt;X&lt;/mark&gt;</p>', { exact: ['X'], reading: [] });
        expect(fragment.querySelectorAll('mark')).toHaveLength(1);
        expect(fragment.querySelector('p')!.textContent).toBe('<mark>X</mark>');
    });
});

describe('highlight terms', () => {
    it('splits the query and the snippet marks into exact and reading terms', () => {
        expect(splitHighlightTerms('春', ['春', 'はる'], ['はる'])).toEqual({ exact: ['春'], reading: ['はる'] });
        expect(splitHighlightTerms(undefined, undefined, undefined)).toEqual(NONE);
    });
    it('round-trips through a stable string key', () => {
        const key = highlightKey('春', ['春', 'はる'], ['はる']);
        expect(key).toBe(highlightKey('春', ['春', 'はる'], ['はる']));
        expect(parseHighlightKey(key)).toEqual({ exact: ['春'], reading: ['はる'] });
    });
    it('does nothing without terms', () => {
        const p = document.createElement('p');
        p.textContent = '春';
        highlightTextNodes(p, [], EXACT_MARK_CLASS);
        expect(p.innerHTML).toBe('春');
    });
});
