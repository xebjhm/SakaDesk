import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRef } from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '../../store/appStore';
import { SearchModal, type SearchModalHandle } from './SearchModal';
import type { SearchResponse } from './types';

const result = (id: number) => ({
    result_type: 'message' as const, message_id: id, content: `m${id}`, snippet: `<mark>m</mark>${id}`,
    service: 'hinatazaka46', group_id: 34, group_name: 'G', member_id: 58, member_name: '金村 美玖',
    timestamp: '2026-11-04T10:00:00Z', type: 'text' as const, is_group_chat: false,
});
const RESPONSE: SearchResponse = { query: 'm', normalized_query: 'm', total_count: 2, has_more: false, results: [result(1), result(2)] };
const MEMBERS = { members: [], services: [] };
const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body });

async function openWithResults() {
    const ref = createRef<SearchModalHandle>();
    render(<SearchModal ref={ref} />);
    act(() => ref.current!.open());
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'm' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    return input;
}

describe('SearchModal keyboard (UI health #5)', () => {
    beforeEach(() => {
        Element.prototype.scrollIntoView = vi.fn();
        useAppStore.setState({ activeService: 'hinatazaka46', selectedServices: ['hinatazaka46'], selectedConversations: {}, targetMessageId: null });
        vi.stubGlobal('fetch', vi.fn((url: string) => (url.startsWith('/api/search?') ? json(RESPONSE) : json(url.startsWith('/api/search/members') ? MEMBERS : {}))));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('is a combobox pointing at the highlighted option', async () => {
        const input = await openWithResults();
        const options = screen.getAllByRole('option');
        expect(screen.getByRole('listbox', { name: 'Search results' })).toBeInTheDocument();
        expect(input).toHaveAttribute('aria-expanded', 'true');
        expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
        expect(options[0]).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
    });

    it('lets Tab move focus to the next control instead of the selection', async () => {
        const input = await openWithResults();
        input.focus();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: 'Filters' })).toHaveFocus();
        expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('lets Enter on a focused button do its own job', async () => {
        await openWithResults();
        screen.getByRole('button', { name: 'Filters' }).focus();
        await userEvent.keyboard('{Enter}');
        expect(useAppStore.getState().targetMessageId).toBeNull();
        expect(screen.getByRole('textbox', { name: /Filter by member/ })).toBeInTheDocument();
    });

    it('leaves the arrows to the IME while it composes', async () => {
        const input = await openWithResults();
        fireEvent.keyDown(input, { key: 'ArrowDown', isComposing: true });
        fireEvent.keyDown(input, { key: 'ArrowDown', keyCode: 229 });
        expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('drops a slower answer to an older query', async () => {
        const slow = { ...RESPONSE, results: [result(9)] };
        let resolveOld: (v: unknown) => void = () => {};
        vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
            if (!url.startsWith('/api/search?')) return json(url.startsWith('/api/search/members') ? MEMBERS : {});
            if (url.includes('q=old')) {
                return new Promise((resolve, reject) => {
                    resolveOld = () => resolve({ ok: true, status: 200, json: async () => slow });
                    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
                });
            }
            return json(RESPONSE);
        }));
        const ref = createRef<SearchModalHandle>();
        render(<SearchModal ref={ref} />);
        act(() => ref.current!.open());
        const input = await screen.findByRole('combobox');
        fireEvent.change(input, { target: { value: 'old' } });
        await new Promise((r) => setTimeout(r, 350)); // past the debounce: the old request is in flight
        fireEvent.change(input, { target: { value: 'new' } });
        await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
        act(() => resolveOld(undefined));
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.getAllByRole('option')).toHaveLength(2);
    });
});
