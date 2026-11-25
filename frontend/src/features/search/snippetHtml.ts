/**
 * Search snippet HTML. The backend escapes the archived text and adds only <mark> elements
 * (search_service._mark_spans, security audit 2026-11-13); these helpers keep that contract
 * on the client: marks are read from the parsed DOM, never from the HTML string, and the
 * user's nickname is inserted as text.
 */
import DOMPurify from 'dompurify';

/** The texts of the snippet's marks, and those drawn as reading matches. */
export function snippetMarks(snippet: string): { matched: string[]; reading: string[] } {
    const fragment = DOMPurify.sanitize(snippet, {
        ALLOWED_TAGS: ['mark'],
        ALLOWED_ATTR: ['class'],
        RETURN_DOM_FRAGMENT: true,
    });
    const matched: string[] = [];
    const reading: string[] = [];
    fragment.querySelectorAll('mark').forEach((mark) => {
        const text = mark.textContent ?? '';
        if (!text) return;
        matched.push(text);
        if (mark.classList.contains('reading')) reading.push(text);
    });
    return { matched, reading };
}

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

/** `text` with the five HTML-significant characters escaped. */
export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** The snippet with the %%% / ％％％ placeholders replaced by the nickname, as text. */
export function fillNickname(snippet: string, nickname: string): string {
    return snippet.replace(/%%%|％％％/g, () => escapeHtml(nickname));
}
