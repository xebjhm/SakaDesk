// src/utils/navigateToSource.ts
// Shared deep-link navigation util — jumps the app to the exact blog post or
// message a citation/search result points to. Used by both the search modal
// and the AI knowledge-base chat citations.

import { useAppStore } from '../store/appStore';
import { getServiceDisplayName } from '../data/services';
import { formatName } from './nameFormatters';

/**
 * A reference to a piece of source content (blog post or chat message) that
 * `navigateToSource` can deep-link to. Mirrors the backend `SourceRef` →
 * `Citation.source_ref` serialization (see Plan B Shared Contracts).
 */
export interface CitationReference {
  type: 'blog' | 'message';
  service: string;

  // ─── Blog fields ───────────────────────────────────────────────────────
  blogId?: string;
  memberId?: number;
  /** Search query to highlight in the blog reader (search-originated navigation only). */
  searchQuery?: string;
  /** Exact matched terms (from search snippet `<mark>` tags) to highlight. */
  matchedTerms?: string[];
  /** Matched terms that came from a reading (furigana) match, not literal text. */
  readingTerms?: string[];

  // ─── Message fields ────────────────────────────────────────────────────
  groupId?: number;
  groupName?: string;
  memberName?: string;
  messageId?: number;
  isGroupChat?: boolean;
}

/**
 * Navigates the app to the exact source (blog post or message) described by
 * `ref`, performing the same store-action sequence regardless of caller
 * (search results, AI chat citations, etc.).
 *
 * This is a plain function (not a hook) — it reads/writes the store via
 * `useAppStore.getState()` so it can be called from event handlers outside
 * React's render cycle.
 */
export function navigateToSource(ref: CitationReference): void {
  const {
    setActiveService,
    setActiveFeature,
    setSelectedConversation,
    triggerConversationNavigation,
    setTargetMessageId,
    setTargetBlog,
    activeService,
    selectedServices,
    setSelectedServices,
  } = useAppStore.getState();

  // Ensure the target service is in selectedServices so ServiceRail shows it
  if (!selectedServices.includes(ref.service)) {
    setSelectedServices([...selectedServices, ref.service]);
  }

  if (ref.type === 'blog') {
    setTargetBlog({
      blogId: ref.blogId!,
      service: ref.service,
      memberId: ref.memberId!,
      searchQuery: ref.searchQuery ?? '',
      matchedTerms: ref.matchedTerms ?? [],
      readingTerms: ref.readingTerms ?? [],
    });
    setActiveFeature(ref.service, 'blogs');
    if (activeService !== ref.service) {
      setActiveService(ref.service);
    }
    return;
  }

  // Message reference → navigate to conversation
  const serviceDisplay = getServiceDisplayName(ref.service);
  const isGroupChat = ref.isGroupChat ?? false;

  const path = isGroupChat
    ? `${serviceDisplay}/messages/${ref.groupId} ${ref.groupName}`
    : `${serviceDisplay}/messages/${ref.groupId} ${ref.groupName}/${ref.memberId} ${ref.memberName}`;

  setSelectedConversation(ref.service, {
    path,
    name: isGroupChat ? formatName(ref.groupName!) : formatName(ref.memberName!),
    isGroupChat,
  });
  setActiveFeature(ref.service, 'messages');
  setTargetMessageId(ref.messageId!);

  if (activeService !== ref.service) {
    setActiveService(ref.service);
  } else {
    triggerConversationNavigation();
  }
}
