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
    expect(vi.mocked(fetch).mock.calls.some(([u]) => u === '/api/client-log')).toBe(false);
  });
});
