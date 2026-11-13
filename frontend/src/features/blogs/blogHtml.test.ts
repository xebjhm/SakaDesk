import { describe, it, expect } from 'vitest';
import {
    buildBlogFragment, highlightKey, highlightTextNodes, parseHighlightKey,
    splitHighlightTerms, EXACT_MARK_CLASS, READING_MARK_CLASS,
} from './blogHtml';

const NONE = { exact: [] as string[], reading: [] as string[] };

function serialize(fragment: DocumentFragment): string {
    const box = document.createElement('div');
    box.append(fragment.cloneNode(true));
    return box.innerHTML;
}

const APP = 'http://127.0.0.1:8000';
const POST_BASE = 'https://blog.example.com/m/1/';

/** The first element's attribute after sanitizing `<tag attr="value">`; null when removed. */
function urlOf(tag: 'img' | 'a', value: string, base: string = POST_BASE): string | null {
    const attr = tag === 'img' ? 'src' : 'href';
    const el = buildBlogFragment(`<${tag} ${attr}="${value}">x</${tag}>`, NONE, base, APP).querySelector(tag)!;
    return el.getAttribute(attr);
}

describe('post URLs', () => {
    it('removes the attribute for loopback and app URLs', () => {
        for (const tag of ['img', 'a'] as const) {
            for (const value of [
                'HTTP://127.0.0.1:8000/api/settings', '//127.0.0.1:1234/api/x', 'http://localhost:9999/x',
                'http://[::1]/x', 'http://0.0.0.0/x', 'http://127.1.2.3:80/x', 'http://[::ffff:127.0.0.1]/x', 'http://[::127.0.0.1]/x',
                'http://2130706433/x', 'http://localhost./x', 'http:/api/settings', 'http:api/x',
                'javascript:alert(1)', 'ftp://example.com/x', 'file:///etc/passwd',
            ]) {
                expect(urlOf(tag, value)).toBeNull();
            }
        }
    });
    it('keeps no path to the app origin from base-relative lookalikes', () => {
        for (const value of ['http/../api/settings', 'https/../api/session/bootstrap', '/api/settings', '/api/content/media/x']) {
            const resolved = urlOf('img', value);
            expect(resolved).not.toBeNull();
            expect(new URL(resolved!).origin).toBe('https://blog.example.com');
        }
    });
    it('keeps cached blog images as relative app URLs', () => {
        expect(urlOf('img', '/api/blogs/image?service=hinatazaka46&amp;blog_id=1&amp;filename=img_0.jpg'))
            .toBe('/api/blogs/image?service=hinatazaka46&blog_id=1&filename=img_0.jpg');
        expect(urlOf('img', 'http://127.0.0.1:8000/api/blogs/image?x=1')).toBe('/api/blogs/image?x=1');
    });
    it('does not keep the cached-image endpoint on a link', () => {
        expect(urlOf('a', 'http://127.0.0.1:8000/api/blogs/image?x=1')).toBeNull();
        expect(urlOf('a', '/api/blogs/image?a=1', '')).toBeNull();
        // Even with a base it is dropped (inert), not resolved to a 404 on the official site.
        expect(urlOf('a', '/api/blogs/image?a=1')).toBeNull();
        expect(urlOf('a', '/api/blogs/image')).toBeNull();
        // Other relative links still resolve on the blog base.
        expect(urlOf('a', '/api/blogs/other')).toBe('https://blog.example.com/api/blogs/other');
    });
    it('keeps absolute off-origin URLs and resolves relative ones on the blog base', () => {
        expect(urlOf('img', 'https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
        expect(urlOf('a', 'https://example.com/x')).toBe('https://example.com/x');
        expect(urlOf('img', 'img/a.jpg')).toBe('https://blog.example.com/m/1/img/a.jpg');
        expect(urlOf('img', '//cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
        expect(urlOf('a', '/s/official/diary/1')).toBe('https://blog.example.com/s/official/diary/1');
    });
    it('treats a base without a trailing slash as a directory', () => {
        expect(urlOf('img', 'a.jpg', 'https://www.hinatazaka46.com')).toBe('https://www.hinatazaka46.com/a.jpg');
    });
    it('fails closed without a base: relative values are dropped, absolute ones kept', () => {
        expect(urlOf('img', '//x.example/a.jpg', '')).toBe('https://x.example/a.jpg');
        expect(urlOf('img', 'http/../api/x', '')).toBeNull();
        expect(urlOf('img', 'a.jpg', '')).toBeNull();
        expect(urlOf('img', '/api/settings', '')).toBeNull();
        expect(urlOf('img', 'http:/api/x', '')).toBeNull();
        expect(urlOf('img', 'https://cdn.example.com/a.jpg', '')).toBe('https://cdn.example.com/a.jpg');
        expect(urlOf('img', '/api/blogs/image?a=1', '')).toBe('/api/blogs/image?a=1');
    });
    it('keeps data images on img src only', () => {
        const data = 'data:image/png;base64,iVBORw0KGgo=';
        expect(urlOf('img', data)).toBe(data);
        expect(urlOf('a', data)).toBeNull();
    });
});

describe('buildBlogFragment', () => {
    it('drops scripts and event handlers', () => {
        const fragment = buildBlogFragment('<p onclick="x()">hi<script>x()</script><img src="a.jpg" onerror="x()"></p>', NONE, POST_BASE, APP);
        expect(serialize(fragment)).toBe('<p>hi<img src="https://blog.example.com/m/1/a.jpg"></p>');
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
