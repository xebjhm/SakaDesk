import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Search, Loader2, Database } from 'lucide-react';
import { Portal } from '../../core/common/Portal';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { formatName } from '../../utils';
import { getServiceDisplayName } from '../../data/services';
import { SearchInput } from './components/SearchInput';
import { SearchFilterBar } from './components/SearchFilterBar';
import { SearchResultList } from './components/SearchResultList';
import type { SearchResult, SearchResponse, FilterChip, DateRangePreset, ContentTypeFilter } from './types';

export interface SearchModalHandle {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

interface SearchModalProps {
  userNicknames?: Record<string, string>;
  blogBackupEnabled?: boolean;
  onOpenSettings?: () => void;
}

export const SearchModal = forwardRef<SearchModalHandle, SearchModalProps>(({ userNicknames, blogBackupEnabled, onOpenSettings }, ref) => {
  const { t } = useTranslation();

  // ─── Local state ───────────────────────────────────────────────────────────
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isComposing, setIsComposing] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<FilterChip[]>([]);
  const [exactOnly, setExactOnly] = useState(false);
  const [includeUnread, setIncludeUnread] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangePreset>('all');
  const [contentType, setContentType] = useState<ContentTypeFilter>('all');
  const [isIndexBuilding, setIsIndexBuilding] = useState(false);
  // Bumped when index build completes — triggers search re-execution
  const [searchGeneration, setSearchGeneration] = useState(0);

  // ─── Refs ──────────────────────────────────────────────────────────────────
  const inputRef = useRef<HTMLInputElement>(null!);
  const listRef = useRef<HTMLDivElement>(null!);
  const wasBuilding = useRef(false);

  // ─── Open / Close ──────────────────────────────────────────────────────────
  const resetState = useCallback(() => {
    setQuery('');
    setResults([]);
    setError(null);
    setSelectedIndex(-1);
    setIsLoading(false);
    setIsLoadingMore(false);
    setIsComposing(false);
    setTotalCount(0);
    setHasMore(false);
    setFiltersExpanded(false);
    setSelectedFilters([]);
    setExactOnly(false);
    setIncludeUnread(false);
    setDateRange('all');
    setContentType('all');
  }, []);

  const open = useCallback(() => {
    setIsOpen(true);
    resetState();
    // Default content type based on blog backup setting
    setContentType(blogBackupEnabled ? 'all' : 'messages');
  }, [resetState, blogBackupEnabled]);

  const close = useCallback(() => {
    setIsOpen(false);
    resetState();
  }, [resetState]);

  useImperativeHandle(ref, () => ({ open, close, isOpen }), [open, close, isOpen]);

  // ─── Focus input when modal opens ──────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      // Small delay to allow portal to mount
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // ─── Check search index status when modal opens ──────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const checkStatus = () => {
      fetch('/api/search/status')
        .then(res => res.json())
        .then(data => {
          if (cancelled) return;
          const building = data.is_building ?? false;
          setIsIndexBuilding(building);
          if (building) {
            wasBuilding.current = true;
            setTimeout(checkStatus, 3000);
          } else if (wasBuilding.current) {
            // Build just finished — re-trigger search
            wasBuilding.current = false;
            setSearchGeneration(g => g + 1);
          }
        })
        .catch(() => {});
    };
    checkStatus();
    return () => { cancelled = true; };
  }, [isOpen]);

  const PAGE_SIZE = 50;

  // Build URL params from current filter state
  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    const serviceFilters = selectedFilters.filter(f => f.type === 'service').map(f => f.id);
    if (serviceFilters.length) params.set('services', serviceFilters.join(','));
    // Member chips use "service:id1+id2" format — expand into individual service:member_id pairs
    const memberFilterPairs: string[] = [];
    for (const f of selectedFilters.filter(f => f.type === 'member')) {
      const colonIdx = f.id.indexOf(':');
      const service = f.id.slice(0, colonIdx);
      for (const mid of f.id.slice(colonIdx + 1).split('+')) {
        memberFilterPairs.push(`${service}:${mid}`);
      }
    }
    if (memberFilterPairs.length) params.set('member_filters', memberFilterPairs.join(','));
    if (exactOnly) params.set('exact_only', 'true');
    if (!includeUnread) params.set('exclude_unread', 'true');
    if (contentType !== 'all') params.set('content_type', contentType);
    if (dateRange !== 'all') {
      const now = new Date();
      let from: Date;
      switch (dateRange) {
        case '7d': from = new Date(now.getTime() - 7 * 86400000); break;
        case '30d': from = new Date(now.getTime() - 30 * 86400000); break;
        case '3m': from = new Date(now.getTime() - 90 * 86400000); break;
        case '1y': from = new Date(now.getTime() - 365 * 86400000); break;
        default: from = new Date(0);
      }
      params.set('date_from', from.toISOString());
    }
    return params.toString();
  }, [selectedFilters, exactOnly, includeUnread, dateRange, contentType]);

  // ─── API call with debounce ────────────────────────────────────────────────
  useEffect(() => {
    if (!query.trim() || isComposing) {
      setResults([]);
      setError(null);
      setIsLoading(false);
      setTotalCount(0);
      setHasMore(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const timer = setTimeout(async () => {
      try {
        const filterParams = buildFilterParams();
        const url = `/api/search?q=${encodeURIComponent(query.trim())}&limit=${PAGE_SIZE}&offset=0${filterParams ? '&' + filterParams : ''}`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data: SearchResponse = await response.json();
        // If the index is still building, show the building banner
        // and auto-retry when it finishes (via status polling).
        if (data.is_building) {
          setIsIndexBuilding(true);
          setResults([]);
          setTotalCount(0);
          setHasMore(false);
          setSelectedIndex(-1);
          return;
        }
        setIsIndexBuilding(false);
        setResults(data.results);
        setTotalCount(data.total_count);
        setHasMore(data.has_more);
        setSelectedIndex(data.results.length > 0 ? 0 : -1);
      } catch (_err) {
        setError(t('search.errorSearchFailed'));
        setResults([]);
        setSelectedIndex(-1);
        setTotalCount(0);
        setHasMore(false);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, isComposing, t, buildFilterParams, searchGeneration]);

  // ─── Load more handler ──────────────────────────────────────────────────────
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || !query.trim()) return;
    setIsLoadingMore(true);
    try {
      const filterParams = buildFilterParams();
      const url = `/api/search?q=${encodeURIComponent(query.trim())}&limit=${PAGE_SIZE}&offset=${results.length}${filterParams ? '&' + filterParams : ''}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: SearchResponse = await response.json();
      setResults((prev) => [...prev, ...data.results]);
      setHasMore(data.has_more);
      setTotalCount(data.total_count);
    } catch (_err) {
      // Silently fail — user can try again
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, query, results.length, buildFilterParams]);

  // selectedIndex is managed by search effect (reset on new search)
  // and preserved across load-more operations.

  // ─── Navigation handler ────────────────────────────────────────────────────
  const handleNavigate = useCallback(
    (result: SearchResult) => {
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
      if (!selectedServices.includes(result.service)) {
        setSelectedServices([...selectedServices, result.service]);
      }

      // Blog search result → navigate to BlogReader
      if (result.result_type === 'blog') {
        // Extract actual matched text from snippet <mark> tags.
        // For reading-based matches (e.g., query "かわいい" matching "可愛い"),
        // the <mark> tags contain the original text which BlogReader needs
        // to highlight and scroll to the correct position.
        const matchedTerms: string[] = [];
        const readingTerms: string[] = [];
        if (result.snippet) {
          const markRegex = /<mark([^>]*)>([^<]+)<\/mark>/g;
          let m;
          while ((m = markRegex.exec(result.snippet)) !== null) {
            matchedTerms.push(m[2]);
            if (m[1].includes('reading')) {
              readingTerms.push(m[2]);
            }
          }
        }
        setTargetBlog({
          blogId: result.blog_id,
          service: result.service,
          memberId: result.member_id,
          searchQuery: query,
          matchedTerms: [...new Set(matchedTerms)],
          readingTerms: [...new Set(readingTerms)],
        });
        setActiveFeature(result.service, 'blogs');
        if (activeService !== result.service) {
          setActiveService(result.service);
        }
        close();
        return;
      }

      // Message search result → navigate to conversation
      const serviceDisplay = getServiceDisplayName(result.service);
      const isGroupChat = result.is_group_chat ?? false;

      const path = isGroupChat
        ? `${serviceDisplay}/messages/${result.group_id} ${result.group_name}`
        : `${serviceDisplay}/messages/${result.group_id} ${result.group_name}/${result.member_id} ${result.member_name}`;

      setSelectedConversation(result.service, {
        path,
        name: isGroupChat ? formatName(result.group_name) : formatName(result.member_name),
        isGroupChat,
      });
      setActiveFeature(result.service, 'messages');
      setTargetMessageId(result.message_id);

      if (activeService !== result.service) {
        setActiveService(result.service);
      } else {
        triggerConversationNavigation();
      }

      close();
    },
    [close, query]
  );

  // ─── Keyboard handler ─────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          if (results.length === 0) return;
          setSelectedIndex((prev) =>
            prev < results.length - 1 ? prev + 1 : 0
          );
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          if (results.length === 0) return;
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : results.length - 1
          );
          break;
        }
        case 'Tab': {
          e.preventDefault();
          if (results.length === 0) return;
          if (e.shiftKey) {
            setSelectedIndex((prev) =>
              prev > 0 ? prev - 1 : results.length - 1
            );
          } else {
            setSelectedIndex((prev) =>
              prev < results.length - 1 ? prev + 1 : 0
            );
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < results.length) {
            handleNavigate(results[selectedIndex]);
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          close();
          break;
        }
      }
    },
    [results, selectedIndex, handleNavigate, close]
  );

  // ─── Derived state ─────────────────────────────────────────────────────────
  const blogCount = useMemo(
    () => results.filter((r) => r.result_type === 'blog').length,
    [results]
  );

  // ─── Render ────────────────────────────────────────────────────────────────
  if (!isOpen) return null;

  return (
    <Portal>
      {/* Overlay container */}
      <div
        className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] p-4"
        onClick={close}
        onKeyDown={handleKeyDown}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/40" />

        {/* Modal panel */}
        <div
          className="relative bg-white rounded-xl w-full max-w-xl shadow-2xl flex flex-col max-h-[60vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search input */}
          <SearchInput
            value={query}
            onChange={setQuery}
            isLoading={isLoading}
            inputRef={inputRef}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onFilterToggle={() => setFiltersExpanded(!filtersExpanded)}
            filtersActive={filtersExpanded || selectedFilters.length > 0}
          />

          {/* Filter bar (collapsible) — outside overflow wrapper so dropdowns can overflow */}
          {filtersExpanded && (
            <SearchFilterBar
              selectedFilters={selectedFilters}
              onFiltersChange={setSelectedFilters}
              exactOnly={exactOnly}
              onExactOnlyChange={setExactOnly}
              includeUnread={includeUnread}
              onIncludeUnreadChange={setIncludeUnread}
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              contentType={contentType}
              onContentTypeChange={setContentType}
              blogBackupEnabled={blogBackupEnabled}
              onOpenBlogSettings={onOpenSettings ? () => { close(); onOpenSettings(); } : undefined}
            />
          )}

          {/* Content zone — overflow-hidden clips children to bottom rounded corners
              while keeping filter dropdowns above free to overflow the modal */}
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden rounded-b-xl">

          {/* Index building banner */}
          {isIndexBuilding && (
            <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700">
              <Database className="w-3.5 h-3.5 shrink-0" />
              <span>{t('search.buildingHint')}</span>
            </div>
          )}

          {/* Loading state (only when no results yet) */}
          {isLoading && results.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="flex items-center justify-center py-12 px-4">
              <p className="text-sm text-red-500">{error}</p>
            </div>
          )}

          {/* Empty state (hide while index is building — results will come after build) */}
          {!isLoading && !error && !isIndexBuilding && query.trim() && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <Search className="w-10 h-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-500">
                {t('search.noResults')}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {t('search.noResultsHint')}
              </p>
            </div>
          )}

          {/* Results list */}
          {results.length > 0 && (
            <SearchResultList
              results={results}
              selectedIndex={selectedIndex}
              onSelect={handleNavigate}
              onMouseEnterItem={setSelectedIndex}
              listRef={listRef}
              userNicknames={userNicknames}
            />
          )}

          {/* Load more button */}
          {hasMore && results.length > 0 && (
            <button
              className="w-full py-2 text-xs text-blue-500 hover:text-blue-700 hover:bg-blue-50 border-t border-gray-100 transition-colors disabled:opacity-50"
              onClick={handleLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" />
              ) : null}
              {t('search.loadMore')}
            </button>
          )}

          {/* Footer */}
          {results.length > 0 && (
            <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-400 flex flex-col gap-1">
              <div className="flex justify-between">
                <span>
                  {totalCount > results.length
                    ? t('search.resultCountPartial', { shown: results.length, total: totalCount })
                    : blogCount > 0
                      ? t('search.resultCountWithBlogs', { count: results.length, blogCount })
                      : t('search.resultCount', { count: results.length })}
                </span>
                <span>{t('search.pressEnterToSelect')}</span>
              </div>
              {blogCount > 0 && (
                <span className="text-gray-300 text-[10px]">
                  {t('search.blogCacheHint')}
                </span>
              )}
            </div>
          )}
          </div>{/* end content zone */}
        </div>
      </div>

      {/* Global styles for search snippet <mark> highlighting */}
      <style>{`
        .search-snippet mark {
          background-color: rgb(254 240 138);
          color: inherit;
          border-radius: 2px;
          padding: 0 2px;
        }
        .search-snippet mark.reading {
          background-color: rgb(219 234 254);
          border-bottom: 1.5px dashed rgb(96 165 250);
        }
      `}</style>
    </Portal>
  );
});

SearchModal.displayName = 'SearchModal';
