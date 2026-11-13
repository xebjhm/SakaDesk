import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Search, Database } from 'lucide-react';
import { Button, Modal, Spinner, StatusBlock } from '../../design/primitives';
import { logDialogLoad } from '../../design/dialog/dialogLog';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { openChat } from '../../shell/openChat';
import { getServiceDisplayName } from '../../data/services';
import { SearchInput } from './components/SearchInput';
import { SearchFilterBar } from './components/SearchFilterBar';
import { SearchResultList } from './components/SearchResultList';
import { snippetMarks } from './snippetHtml';
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
  const [error, setError] = useState(false);
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
  const [blogSyncInProgress, setBlogSyncInProgress] = useState(false);
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
    setError(false);
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

  // ─── Check search index status when modal opens ──────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const checkStatus = () => {
      fetch('/api/search/status')
        .then(res => res.json())
        .then(data => {
          if (cancelled) { logDialogLoad('search_status', 'cancelled'); return; }
          const building = data.is_building ?? false;
          setIsIndexBuilding(building);
          if (building) {
            wasBuilding.current = true;
            setTimeout(checkStatus, 3000);
            return;
          }
          logDialogLoad('search_status', 'ok');
          if (wasBuilding.current) {
            // Build just finished — re-trigger search
            wasBuilding.current = false;
            setSearchGeneration(g => g + 1);
          }
        })
        // The banner keeps its last state; the poll stops until the dialog reopens.
        .catch(() => logDialogLoad('search_status', 'error'));
    };
    checkStatus();
    return () => { cancelled = true; };
  }, [isOpen]);

  // ─── Poll blog backup status when modal is open ────────────────────────────
  useEffect(() => {
    if (!isOpen || !blogBackupEnabled) {
      setBlogSyncInProgress(false);
      return;
    }
    let cancelled = false;
    const checkBackup = () => {
      fetch('/api/blogs/backup/status')
        .then(res => res.json())
        .then(data => {
          if (cancelled) { logDialogLoad('search_backup_status', 'cancelled'); return; }
          const anyRunning = Object.keys(data.running ?? {}).length > 0;
          setBlogSyncInProgress(anyRunning);
          if (anyRunning) setTimeout(checkBackup, 5000);
          else logDialogLoad('search_backup_status', 'ok');
        })
        .catch(() => logDialogLoad('search_backup_status', 'error'));
    };
    checkBackup();
    return () => { cancelled = true; };
  }, [isOpen, blogBackupEnabled]);

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
      setError(false);
      setIsLoading(false);
      setTotalCount(0);
      setHasMore(false);
      return;
    }

    setIsLoading(true);
    setError(false);

    const timer = setTimeout(async () => {
      try {
        const filterParams = buildFilterParams();
        const url = `/api/search?q=${encodeURIComponent(query.trim())}&limit=${PAGE_SIZE}&offset=0${filterParams ? '&' + filterParams : ''}`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data: SearchResponse = await response.json();
        // Show building banner if index is still being built, but
        // still render whatever partial results the backend returned.
        setIsIndexBuilding(!!data.is_building);
        setResults(data.results);
        logDialogLoad('search', 'ok', data.results.length);
        setTotalCount(data.total_count);
        setHasMore(data.has_more);
        setSelectedIndex(data.results.length > 0 ? 0 : -1);
      } catch (_err) {
        setError(true);
        logDialogLoad('search', 'error');
        setResults([]);
        setSelectedIndex(-1);
        setTotalCount(0);
        setHasMore(false);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, isComposing, buildFilterParams, searchGeneration]);

  // ─── Load more handler ──────────────────────────────────────────────────────
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || !query.trim()) {
      logDialogLoad('search_more', 'skipped');
      return;
    }
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
      logDialogLoad('search_more', 'ok', data.results.length);
    } catch (_err) {
      // The button stays, so the user can try again.
      logDialogLoad('search_more', 'error');
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
        // The marks' texts, read from the parsed snippet (snippetHtml.ts). For reading-based
        // matches (e.g., query "かわいい" matching "可愛い") the marks hold the original text,
        // which BlogReader highlights and scrolls to.
        const { matched, reading } = snippetMarks(result.snippet ?? '');
        setTargetBlog({
          blogId: result.blog_id,
          service: result.service,
          memberId: result.member_id,
          searchQuery: query,
          matchedTerms: [...new Set(matched)],
          readingTerms: [...new Set(reading)],
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

      // targetMessageId must be set before openChat switches service / triggers
      // navigation, so the destination view sees it on mount.
      setTargetMessageId(result.message_id);
      openChat({
        service: result.service,
        path,
        name: isGroupChat ? result.group_name : result.member_name,
        is_group_chat: isGroupChat,
      });

      close();
    },
    [close, query]
  );

  // ─── Keyboard handler ─────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Enter and Escape confirm or cancel an IME candidate first: leave them to the IME.
      const composing = e.nativeEvent.isComposing || e.keyCode === 229;
      if (composing && (e.key === 'Enter' || e.key === 'Escape')) return;
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
  return (
    <Modal
      isOpen={isOpen}
      scope="brand"
      onClose={close}
      layout="bare"
      placement="top"
      aria-label={t('search.title')}
      initialFocusRef={inputRef}
      onKeyDown={handleKeyDown}
      logId="search"
      className="max-h-[60vh] max-w-xl overflow-visible"
    >
      <SearchInput
        value={query}
        onChange={setQuery}
        isLoading={isLoading}
        inputRef={inputRef}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onFilterToggle={() => setFiltersExpanded(!filtersExpanded)}
        filtersActive={filtersExpanded || selectedFilters.length > 0}
        contentType={contentType}
      />

      {blogBackupEnabled && blogSyncInProgress && (
        <p role="status" className="flex items-center gap-2 bg-sunken px-4 py-2 text-caption text-secondary">
          <Spinner size="sm" tone="muted" decorative />
          {t('search.blogBackupInProgress')}
        </p>
      )}

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
          refetchKey={searchGeneration}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-sheet">
        {isIndexBuilding && (
          <p role="status" className="flex items-center gap-2 bg-sunken px-4 py-2 text-caption text-secondary">
            <Database aria-hidden="true" className="h-4 w-4 shrink-0" />
            {t('search.buildingHint')}
          </p>
        )}
        {isLoading && results.length === 0 && <StatusBlock kind="loading" surface="dialog_search" className="py-8" />}
        {/* Retry bumps searchGeneration, which also feeds the filter bar's refetchKey (a harmless extra refetch). */}
        {error && <StatusBlock kind="error" surface="dialog_search" title={t('search.searchFailed')} onRetry={() => setSearchGeneration((g) => g + 1)} className="py-8" />}
        {!isLoading && !error && !isIndexBuilding && query.trim() && results.length === 0 && (
          <StatusBlock kind="empty" surface="dialog_search" icon={<Search />} title={t('search.noResults')} hint={t('search.noResultsHint')} className="py-8" />
        )}
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
        {hasMore && results.length > 0 && (
          <Button variant="ghost" size="sm" className="mx-auto my-1" onClick={handleLoadMore} loading={isLoadingMore}>
            {t('search.loadMore')}
          </Button>
        )}
        {results.length > 0 && (
          <div className="flex flex-col gap-1 bg-sunken px-4 py-2 text-caption text-secondary">
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
            {blogCount > 0 && <span>{t('search.blogCacheHint')}</span>}
          </div>
        )}
      </div>
    </Modal>
  );
});

SearchModal.displayName = 'SearchModal';
