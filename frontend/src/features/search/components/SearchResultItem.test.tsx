import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SearchResultItem } from './SearchResultItem';
import type { SearchResult } from '../types';

const RESULT: SearchResult = {
    result_type: 'message',
    message_id: 1,
    content: 'x',
    snippet: '%%%さん a &lt;b&gt; <mark>桜</mark>',
    service: 'hinatazaka46',
    group_id: 1,
    group_name: 'G',
    member_id: 2,
    member_name: 'M',
    timestamp: '2026-11-03T00:00:00Z',
    type: 'text',
};

describe('SearchResultItem snippet', () => {
    it('shows escaped archive text and the nickname as text, with only the marks as markup', () => {
        const { container } = render(
            <SearchResultItem
                result={RESULT}
                isSelected={false}
                onSelect={vi.fn()}
                index={0} optionId="o-0" onHover={vi.fn()}
                userNickname="<img src=x onerror=alert(1)>"
            />,
        );
        const snippet = container.querySelector('.search-snippet')!;
        expect(snippet.querySelector('img')).toBeNull();
        expect(snippet.querySelector('b')).toBeNull();
        expect(snippet.textContent).toBe('<img src=x onerror=alert(1)>さん a <b> 桜');
        expect(snippet.querySelector('mark')!.textContent).toBe('桜');
    });
});
