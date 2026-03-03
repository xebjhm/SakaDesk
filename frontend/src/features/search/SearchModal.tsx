import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Search, Loader2 } from 'lucide-react';
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

export const SearchModal = forwardRef<SearchModalHandle>((_props, ref) => {
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

  // ─── Refs ──────────────────────────────────────────────────────────────────
  const inputRef = useRef<HTMLInputElement>(null!);
  const listRef = useRef<HTMLDivElement>(null!);

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
  }, [resetState]);

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

  const PAGE_SIZE = 50;

  // Build URL params from current filter state
  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    const serviceFilters = selectedFilters.filter(f => f.type === 'service').map(f => f.id);
    const memberFilters = selectedFilters.filter(f => f.type === 'member').map(f => f.id);
    if (serviceFilters.length) params.set('services', serviceFilters.join(','));
    // Member chips use "service:member_id" format to scope per-service
    if (memberFilters.length) params.set('member_filters', memberFilters.join(','));
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
  }, [query, isComposing, t, buildFilterParams]);

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
        activeService,
        selectedServices,
        setSelectedServices,
      } = useAppStore.getState();

      const serviceDisplay = getServiceDisplayName(result.service);
      const isGroupChat = result.is_group_chat ?? false;

      const path = isGroupChat
        ? `${serviceDisplay}/messages/${result.group_id} ${result.group_name}`
        : `${serviceDisplay}/messages/${result.group_id} ${result.group_name}/${result.member_id} ${result.member_name}`;

      // Ensure the target service is in selectedServices so ServiceRail shows it
      if (!selectedServices.includes(result.service)) {
        setSelectedServices([...selectedServices, result.service]);
      }

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
    [close]
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

          {/* Filter bar (collapsible) */}
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
            />
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

          {/* Empty state */}
          {!isLoading && !error && query.trim() && results.length === 0 && (
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
            <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-400 flex justify-between rounded-b-xl">
              <span>
                {totalCount > results.length
                  ? t('search.resultCountPartial', { shown: results.length, total: totalCount })
                  : t('search.resultCount', { count: results.length })}
              </span>
              <span>{t('search.pressEnterToSelect')}</span>
            </div>
          )}
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
