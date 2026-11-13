import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./clientLog', () => ({ clientLog: vi.fn() }));

import { clientLog } from './clientLog';
import { openExternal } from './openExternal';

describe('openExternal', () => {
    let open: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        open = vi.spyOn(window, 'open').mockReturnValue(null);
        vi.mocked(clientLog).mockClear();
    });
    afterEach(() => open.mockRestore());

    it.each([
        'https://www.hinatazaka46.com/s/official/diary/detail/1',
        'http://example.com/a?b=1',
    ])('opens %s in the browser without an opener', (href) => {
        expect(openExternal(href, 'blog_post')).toBe('opened');
        expect(open).toHaveBeenCalledWith(new URL(href).href, '_blank', 'noopener,noreferrer');
        expect(clientLog).toHaveBeenCalledWith('external_link', { surface: 'blog_post', outcome: 'opened' });
    });

    it.each([
        ['mailto:a@example.com', 'scheme'],
        ['javascript:alert(1)', 'scheme'],
        ['ms-settings:', 'scheme'],
        ['file:///C:/Windows/', 'scheme'],
        ['/api/settings', 'invalid'],
        ['#top', 'invalid'],
        ['', 'invalid'],
        [null, 'invalid'],
        [`${window.location.origin}/api/settings`, 'same_origin'],
        ['http://localhost:9999/x', 'loopback'],
        ['http://127.0.0.2/x', 'loopback'],
        ['http://[::1]:8000/x', 'loopback'],
    ])('refuses %s (%s)', (href, reason) => {
        expect(openExternal(href, 'message')).toBe('blocked');
        expect(open).not.toHaveBeenCalled();
        expect(clientLog).toHaveBeenCalledWith('external_link', { surface: 'message', outcome: 'blocked', reason });
    });
});
