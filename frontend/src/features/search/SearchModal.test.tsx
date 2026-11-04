import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRef } from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAppStore } from '../../store/appStore';
import { getServiceDisplayName } from '../../data/services';
import { SearchModal, type SearchModalHandle } from './SearchModal';
import type { SearchResponse } from './types';

const RESPONSE: SearchResponse = {
  query: 'おはよう',
  normalized_query: 'おはよう',
  total_count: 1,
  has_more: false,
  results: [
    {
      result_type: 'message',
      message_id: 4321,
      content: 'おはよう😊',
      snippet: '<mark>おはよう</mark>😊',
      service: 'hinatazaka46',
      group_id: 34,
      group_name: '金村 美玖',
      member_id: 58,
      member_name: '金村 美玖',
      timestamp: '2026-11-04T10:00:00Z',
      type: 'text',
      is_group_chat: false,
    },
  ],
};

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}

describe('SearchModal message result', () => {
  beforeEach(() => {
    // jsdom has no layout: the result list scrolls the selected row into view.
    Element.prototype.scrollIntoView = vi.fn();
    useAppStore.setState({
      activeService: 'hinatazaka46',
      selectedServices: ['hinatazaka46'],
      selectedConversations: {},
      conversationNavCounter: 0,
      targetMessageId: null,
    });
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      url.startsWith('/api/search?') ? jsonResponse(RESPONSE) : jsonResponse({}),
    ));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the conversation scrolled to the matched message', async () => {
    const ref = createRef<SearchModalHandle>();
    render(<SearchModal ref={ref} />);
    act(() => ref.current!.open());

    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'おはよう' } });
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).startsWith('/api/search?'))).toBe(true),
    );
    await waitFor(() => expect(screen.getAllByText(/金村 美玖/).length).toBeGreaterThan(0));
    fireEvent.keyDown(input, { key: 'Enter' });

    const s = useAppStore.getState();
    expect(s.targetMessageId).toBe(4321);
    expect(s.selectedConversations['hinatazaka46']).toMatchObject({
      path: `${getServiceDisplayName('hinatazaka46')}/messages/34 金村 美玖/58 金村 美玖`,
      isGroupChat: false,
    });
    expect(s.conversationNavCounter).toBe(1);
    // Search navigation is not a toast click: no notify_open_chat breadcrumb.
    expect(
      vi.mocked(fetch).mock.calls.some(([u, init]) => u === '/api/client-log' && String((init as RequestInit).body).includes('notify_open_chat')),
    ).toBe(false);
  });
  it('is a named dialog with the input focused, and marks use the mark tokens', async () => {
    const ref = createRef<SearchModalHandle>();
    render(<SearchModal ref={ref} />);
    act(() => ref.current!.open());
    const dialog = await screen.findByRole('dialog', { name: 'Search' });
    const input = screen.getByRole('textbox');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'おはよう' } });
    const mark = await screen.findByText('おはよう', { selector: 'mark' });
    expect(mark.closest('.search-snippet')).toHaveClass('[&_mark]:bg-mark-exact');
    expect(dialog.querySelector('style')).toBeNull();
  });

  it('moves the selection with arrows and Tab, and Enter opens a blog with its highlight', async () => {
    const two: SearchResponse = {
      ...RESPONSE,
      total_count: 2,
      results: [
        { ...RESPONSE.results[0] },
        {
          result_type: 'blog', blog_id: 77, service: 'hinatazaka46', member_id: 58, member_name: '金村 美玖',
          title: 'ブログ', snippet: '<mark>おはよう</mark> <mark class="reading">朝</mark>', published_at: '2026-11-03T00:00:00Z',
        } as unknown as SearchResponse['results'][number],
      ],
    };
    vi.stubGlobal('fetch', vi.fn((url: string) => (url.startsWith('/api/search?') ? jsonResponse(two) : jsonResponse({}))));
    const ref = createRef<SearchModalHandle>();
    render(<SearchModal ref={ref} />);
    act(() => ref.current!.open());
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'おはよう' } });
    await screen.findByText('ブログ');
    const rows = () => Array.from(document.querySelectorAll('.search-snippet')).map((n) => n.parentElement!.parentElement!);
    await waitFor(() => expect(rows()[0]).toHaveClass('bg-group-subtle'));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(rows()[1]).toHaveClass('bg-group-subtle');
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(rows()[0]).toHaveClass('bg-group-subtle');
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(rows()[1]).toHaveClass('bg-group-subtle');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(rows()[0]).toHaveClass('bg-group-subtle');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useAppStore.getState().targetBlog).toMatchObject({
      blogId: 77, matchedTerms: ['おはよう', '朝'], readingTerms: ['朝'],
    });
  });
});
