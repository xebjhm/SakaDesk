import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X, ChevronDown, AlertTriangle } from 'lucide-react';
import { Button, Menu, MenuItem } from '../../../design/primitives';
import { Z_INDEX } from '../../../constants/zIndex';
import { groupMarkerStyle } from '../groupMarker';
import { logDialogLoad } from '../../../design/dialog/dialogLog';
import { useTranslation } from '../../../i18n';
import { getServicePrimaryColor, getServiceDisplayName, sortByServiceOrder } from '../../../data/services';
import { useAppStore } from '../../../store/appStore';
import { formatName } from '../../../utils';
import type { FilterChip, DateRangePreset, ContentTypeFilter, MembersResponse } from '../types';

interface SearchFilterBarProps {
  selectedFilters: FilterChip[];
  onFiltersChange: (filters: FilterChip[]) => void;
  exactOnly: boolean;
  onExactOnlyChange: (value: boolean) => void;
  includeUnread: boolean;
  onIncludeUnreadChange: (value: boolean) => void;
  dateRange: DateRangePreset;
  onDateRangeChange: (preset: DateRangePreset) => void;
  contentType: ContentTypeFilter;
  onContentTypeChange: (value: ContentTypeFilter) => void;
  blogBackupEnabled?: boolean;
  onOpenBlogSettings?: () => void;
  /** Increment to re-fetch members (e.g. after index build completes). */
  refetchKey?: number;
}

const DATE_PRESETS: { value: DateRangePreset; labelKey: string }[] = [
  { value: 'all', labelKey: 'search.allTime' },
  { value: '7d', labelKey: 'search.last7Days' },
  { value: '30d', labelKey: 'search.last30Days' },
  { value: '3m', labelKey: 'search.last3Months' },
  { value: '1y', labelKey: 'search.lastYear' },
];

const CONTENT_TYPE_PRESETS: { value: ContentTypeFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'search.contentAll' },
  { value: 'messages', labelKey: 'search.contentMessages' },
  { value: 'blogs', labelKey: 'search.contentBlogs' },
];

export const SearchFilterBar: React.FC<SearchFilterBarProps> = ({
  selectedFilters,
  onFiltersChange,
  exactOnly,
  onExactOnlyChange,
  includeUnread,
  onIncludeUnreadChange,
  dateRange,
  onDateRangeChange,
  contentType,
  onContentTypeChange,
  blogBackupEnabled,
  onOpenBlogSettings,
  refetchKey,
}) => {
  const { t } = useTranslation();
  const [mentionQuery, setMentionQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [showContentTypeDropdown, setShowContentTypeDropdown] = useState(false);
  const [membersData, setMembersData] = useState<MembersResponse | null>(null);
  const mentionInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const contentTypeTriggerRef = useRef<HTMLButtonElement>(null);
  const dateTriggerRef = useRef<HTMLButtonElement>(null);

  // Fetch members for autocomplete on mount and when index build completes
  useEffect(() => {
    let cancelled = false;
    fetch('/api/search/members')
      .then(r => r.json())
      .then((data: MembersResponse) => {
        if (cancelled) { logDialogLoad('search_members', 'cancelled'); return; }
        setMembersData(data);
        logDialogLoad('search_members', 'ok');
      })
      // The member autocomplete stays empty; services and the other filters still work.
      .catch(() => logDialogLoad('search_members', 'error'));
    return () => { cancelled = true; };
  }, [refetchKey]);

  // Close the mention autocomplete on outside click (the two Menus close themselves)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const serviceOrder = useAppStore((s) => s.getServiceOrder());

  // Filter dropdown items based on query and already-selected chips
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const filteredItems = useMemo(() => {
    if (!membersData) return [];
    const q = mentionQuery.toLowerCase().replace(/^@/, '');
    const selectedIds = new Set(selectedFilters.map(f => f.id));

    const items: { type: 'service' | 'member'; id: string; label: string; sublabel?: string; color: string }[] = [];

    // Services — sorted by global order
    const orderedServices = sortByServiceOrder(membersData.services, serviceOrder, (s) => s.service);
    for (const svc of orderedServices) {
      const id = svc.service;
      if (selectedIds.has(id)) continue;
      const name = getServiceDisplayName(id);
      const color = getServicePrimaryColor(id);
      if (!q || name.toLowerCase().includes(q) || id.toLowerCase().includes(q)) {
        items.push({
          type: 'service',
          id,
          label: name,
          sublabel: `${svc.member_count} members`,
          color,
        });
      }
    }

    // Members — consolidate by (service, member_name) since the same person
    // can have different member_ids in messages vs blogs.
    // Sort by global service order, then by blog_member_id within each service.
    const orderedMembers = [...membersData.members].sort((a, b) => {
      const ai = serviceOrder.indexOf(a.service);
      const bi = serviceOrder.indexOf(b.service);
      const serviceSort = (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
      if (serviceSort !== 0) return serviceSort;
      return (a.blog_member_id ?? Infinity) - (b.blog_member_id ?? Infinity);
    });
    const seen = new Set<string>();
    for (const mem of orderedMembers) {
      const dedup = `${mem.service}:${mem.member_name}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      // Chip id encodes all member_ids so search filters catch both messages and blogs
      const ids = mem.member_ids ?? [mem.member_id];
      const id = `${mem.service}:${ids.join('+')}`;
      if (selectedIds.has(id)) continue;
      const serviceDisplayName = getServiceDisplayName(mem.service);
      // Disambiguate group official accounts whose name matches the service display name
      const isOfficialAccount = mem.member_name === serviceDisplayName;
      const name = isOfficialAccount ? `${formatName(mem.member_name)} (${t('search.official')})` : formatName(mem.member_name);
      const color = getServicePrimaryColor(mem.service);
      if (!q || name.toLowerCase().includes(q) || mem.member_name.toLowerCase().includes(q)) {
        items.push({
          type: 'member',
          id,
          label: name,
          sublabel: serviceDisplayName,
          color,
        });
      }
    }

    return items;
  }, [membersData, mentionQuery, selectedFilters, serviceOrder]);

  const handleSelectItem = useCallback((item: typeof filteredItems[number]) => {
    onFiltersChange([...selectedFilters, { type: item.type, id: item.id, label: item.label, color: item.color }]);
    setMentionQuery('');
    setShowDropdown(false);
    mentionInputRef.current?.focus();
  }, [selectedFilters, onFiltersChange]);

  const handleRemoveChip = useCallback((id: string) => {
    onFiltersChange(selectedFilters.filter(f => f.id !== id));
  }, [selectedFilters, onFiltersChange]);

  return (
    <div className="flex flex-col gap-2 bg-sunken px-4 py-3">
      <div className="flex flex-wrap items-center gap-2" ref={dropdownRef}>
        {selectedFilters.map((chip) => (
          <span key={`${chip.type}-${chip.id}`} className="inline-flex items-center gap-1 rounded-pill bg-pill px-2 py-1 text-caption font-semibold text-primary shadow-pill">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-pill bg-group-marker" style={groupMarkerStyle(chip.color)} />
            <span lang="ja">{chip.label}</span>
            <button type="button" onClick={() => handleRemoveChip(chip.id)} aria-label={t('search.removeFilter', { name: chip.label })} className="rounded-pill text-muted transition-colors duration-fast ease-standard hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        <div className="relative min-w-[120px] flex-1">
          <input
            ref={mentionInputRef}
            type="text"
            value={mentionQuery}
            onChange={(e) => {
              setMentionQuery(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            placeholder={selectedFilters.length === 0 ? t('search.filterByMember') : ''}
            aria-label={t('search.filterByMember')}
            className="w-full bg-transparent py-1 text-small text-primary outline-none placeholder:text-muted"
          />

          {showDropdown && filteredItems.length > 0 && (
            <div role="listbox" className="absolute left-0 top-full mt-1 flex max-h-72 w-64 flex-col overflow-y-auto rounded-card bg-card p-1 shadow-card" style={{ zIndex: Z_INDEX.POPOVER }}>
              {filteredItems.map((item) => (
                <button
                  key={`${item.type}-${item.id}`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => handleSelectItem(item)}
                  className="flex w-full items-center gap-2 rounded-pill px-3 py-2 text-left text-small transition-colors duration-fast ease-standard hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none"
                >
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-pill bg-group-marker" style={groupMarkerStyle(item.color)} />
                  <span lang="ja" className="truncate font-semibold text-primary">{item.label}</span>
                  {item.sublabel && <span lang={item.type === 'member' ? 'ja' : undefined} className="ml-auto truncate text-muted">{item.sublabel}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-small text-secondary">
        {/* Exact match here means literal substring match in original text,
            NOT Levenshtein fuzzy search. When OFF (default), search includes
            pronunciation/reading-based matches via pykakasi-normalized kana. */}
        <label className="flex cursor-pointer select-none items-center gap-2 hover:text-primary">
          <input type="checkbox" checked={exactOnly} onChange={(e) => onExactOnlyChange(e.target.checked)} className="h-4 w-4 cursor-pointer accent-accent" />
          {t('search.exactMatchOnly')}
        </label>

        <label className="flex cursor-pointer select-none items-center gap-2 hover:text-primary">
          <input type="checkbox" checked={includeUnread} onChange={(e) => onIncludeUnreadChange(e.target.checked)} className="h-4 w-4 cursor-pointer accent-accent" />
          {t('search.includeUnread')}
        </label>

        <div className="relative ml-auto">
          <Button ref={contentTypeTriggerRef} variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={showContentTypeDropdown} onClick={() => setShowContentTypeDropdown((v) => !v)}>
            {t(CONTENT_TYPE_PRESETS.find((p) => p.value === contentType)?.labelKey || 'search.contentAll')}
            <ChevronDown className="h-3 w-3" />
          </Button>
          {showContentTypeDropdown && (
            <Menu aria-label={t('search.filters')} onClose={() => setShowContentTypeDropdown(false)} returnFocusRef={contentTypeTriggerRef} ignoreRefs={[contentTypeTriggerRef]} layer="popover" className="absolute right-0 top-full mt-1 w-44">
              {CONTENT_TYPE_PRESETS.map((preset) => (
                <MenuItem key={preset.value} radio selected={contentType === preset.value} onClick={() => { onContentTypeChange(preset.value); setShowContentTypeDropdown(false); }}>
                  {t(preset.labelKey)}
                </MenuItem>
              ))}
            </Menu>
          )}
        </div>

        <div className="relative">
          <Button ref={dateTriggerRef} variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={showDateDropdown} onClick={() => setShowDateDropdown((v) => !v)}>
            {t(DATE_PRESETS.find((p) => p.value === dateRange)?.labelKey || 'search.allTime')}
            <ChevronDown className="h-3 w-3" />
          </Button>
          {showDateDropdown && (
            <Menu aria-label={t('search.filters')} onClose={() => setShowDateDropdown(false)} returnFocusRef={dateTriggerRef} ignoreRefs={[dateTriggerRef]} layer="popover" className="absolute right-0 top-full mt-1 w-44">
              {DATE_PRESETS.map((preset) => (
                <MenuItem key={preset.value} radio selected={dateRange === preset.value} onClick={() => { onDateRangeChange(preset.value); setShowDateDropdown(false); }}>
                  {t(preset.labelKey)}
                </MenuItem>
              ))}
            </Menu>
          )}
        </div>
      </div>

      {(contentType === 'blogs' || contentType === 'all') && !blogBackupEnabled && (
        <p className="flex items-center gap-2 rounded-card bg-card px-3 py-2 text-caption text-secondary shadow-pill">
          <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-status-warning" />
          <span>{t('search.blogSearchLimited')}</span>
          {onOpenBlogSettings && (
            <button type="button" onClick={onOpenBlogSettings} className="whitespace-nowrap font-semibold text-accent-strong underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {t('search.enableFullBackup')}
            </button>
          )}
        </p>
      )}
    </div>
  );
};
