import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { useAppStore } from '../../store/appStore';
import { SearchModal, type SearchModalHandle } from './SearchModal';
import { SearchResultItem } from './components/SearchResultItem';
import type { SearchResult } from './types';

const MESSAGE: SearchResult = {
    result_type: 'message', message_id: 1, content: 'おはよう😊', snippet: '<mark>おはよう</mark>😊',
    service: 'sakurazaka46', group_id: 2, group_name: '山下 瞳月', member_id: 3, member_name: '山下 瞳月',
    timestamp: '2026-11-04T10:00:00Z', type: 'text', is_group_chat: false,
} as SearchResult;

describe('Search (R-c)', () => {
    beforeEach(() => {
        Element.prototype.scrollIntoView = vi.fn();
        useAppStore.setState({ activeService: 'hinatazaka46', selectedServices: ['hinatazaka46'] });
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) })));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('is a brand dialog whichever group is active', () => {
        const ref = createRef<SearchModalHandle>();
        render(<SearchModal ref={ref} />);
        act(() => ref.current!.open());
        expect(screen.getByRole('dialog', { name: 'Search' })).toHaveAttribute('data-scope', 'brand');
    });

    it('selects a result with the accent roles and keeps its group dot', () => {
        render(<SearchResultItem result={MESSAGE} isSelected onSelect={vi.fn()} onMouseEnter={vi.fn()} />);
        const row = screen.getByText('山下 瞳月', { selector: 'span.font-semibold' }).closest('div.flex.w-full') as HTMLElement;
        expect(row).toHaveClass('bg-accent-subtle');
        expect(row.querySelector('.bg-group-marker')).not.toBeNull();
    });

    it('marks member names, room names and snippets as Japanese content', () => {
        render(<SearchResultItem result={MESSAGE} isSelected={false} onSelect={vi.fn()} onMouseEnter={vi.fn()} />);
        for (const el of screen.getAllByText('山下 瞳月')) expect(el).toHaveAttribute('lang', 'ja');
        expect(screen.getByText('おはよう', { selector: 'mark' }).closest('p')).toHaveAttribute('lang', 'ja');
    });
});
