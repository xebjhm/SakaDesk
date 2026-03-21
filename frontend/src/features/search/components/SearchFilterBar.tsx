import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X, ChevronDown } from 'lucide-react';
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
  const dateDropdownRef = useRef<HTMLDivElement>(null);
  const contentTypeDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch members for autocomplete on mount and when index build completes
  useEffect(() => {
    let cancelled = false;
    fetch('/api/search/members')
      .then(r => r.json())
      .then((data: MembersResponse) => {
        if (!cancelled) setMembersData(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [refetchKey]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(e.target as Node)) {
        setShowDateDropdown(false);
      }
      if (contentTypeDropdownRef.current && !contentTypeDropdownRef.current.contains(e.target as Node)) {
        setShowContentTypeDropdown(false);
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
    <div className="bg-gray-100/60 rounded-b-xl">
      {/* Row 1: @-mention input + chips */}
      <div className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5" ref={dropdownRef}>
          {/* Existing chips */}
          {selectedFilters.map((chip) => (
            <span
              key={`${chip.type}-${chip.id}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-white border border-gray-200 text-gray-700"
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: chip.color }} />
              {chip.label}
              <button
                onClick={() => handleRemoveChip(chip.id)}
                className="ml-0.5 hover:text-red-500 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}

          {/* Mention input */}
          <div className="relative flex-1 min-w-[120px]">
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
              className="w-full text-xs bg-transparent outline-none placeholder-gray-400 py-0.5"
            />

            {/* Autocomplete dropdown */}
            {showDropdown && filteredItems.length > 0 && (
              <div className="absolute left-0 top-full mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-72 overflow-y-auto">
                {filteredItems.map((item) => (
                  <button
                    key={`${item.type}-${item.id}`}
                    className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-gray-50 text-left text-xs"
                    onClick={() => handleSelectItem(item)}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                    <span className="font-medium text-gray-700 truncate">{item.label}</span>
                    {item.sublabel && (
                      <span className="text-gray-400 truncate ml-auto">{item.sublabel}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Toggles + date range */}
      <div className="px-3 py-1.5 flex items-center gap-4 text-xs border-t border-gray-100">
        {/* Exact match only toggle */}
        {/* Exact match here means literal substring match in original text,
            NOT Levenshtein fuzzy search. When OFF (default), search includes
            pronunciation/reading-based matches via pykakasi-normalized kana. */}
        <label className="flex items-center gap-1.5 cursor-pointer select-none text-gray-600 hover:text-gray-900">
          <input
            type="checkbox"
            checked={exactOnly}
            onChange={(e) => onExactOnlyChange(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-gray-300 text-blue-500 focus:ring-blue-500 focus:ring-1 cursor-pointer"
          />
          {t('search.exactMatchOnly')}
        </label>

        {/* Include unread toggle */}
        <label className="flex items-center gap-1.5 cursor-pointer select-none text-gray-600 hover:text-gray-900">
          <input
            type="checkbox"
            checked={includeUnread}
            onChange={(e) => onIncludeUnreadChange(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-gray-300 text-blue-500 focus:ring-blue-500 focus:ring-1 cursor-pointer"
          />
          {t('search.includeUnread')}
        </label>

        {/* Content type dropdown */}
        <div className="relative ml-auto" ref={contentTypeDropdownRef}>
          <button
            className="flex items-center gap-1 text-gray-500 hover:text-gray-700 transition-colors"
            onClick={() => setShowContentTypeDropdown(!showContentTypeDropdown)}
          >
            {t(CONTENT_TYPE_PRESETS.find(p => p.value === contentType)?.labelKey || 'search.contentAll')}
            <ChevronDown className="w-3 h-3" />
          </button>
          {showContentTypeDropdown && (
            <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1">
              {CONTENT_TYPE_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  className={`w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 ${
                    contentType === preset.value ? 'text-blue-600 font-medium' : 'text-gray-700'
                  }`}
                  onClick={() => {
                    onContentTypeChange(preset.value);
                    setShowContentTypeDropdown(false);
                  }}
                >
                  {t(preset.labelKey)}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="text-gray-300">|</span>

        {/* Date range dropdown */}
        <div className="relative" ref={dateDropdownRef}>
          <button
            className="flex items-center gap-1 text-gray-500 hover:text-gray-700 transition-colors"
            onClick={() => setShowDateDropdown(!showDateDropdown)}
          >
            {t(DATE_PRESETS.find(p => p.value === dateRange)?.labelKey || 'search.allTime')}
            <ChevronDown className="w-3 h-3" />
          </button>
          {showDateDropdown && (
            <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1">
              {DATE_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  className={`w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 ${
                    dateRange === preset.value ? 'text-blue-600 font-medium' : 'text-gray-700'
                  }`}
                  onClick={() => {
                    onDateRangeChange(preset.value);
                    setShowDateDropdown(false);
                  }}
                >
                  {t(preset.labelKey)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Notice: blog search limited without full backup */}
      {(contentType === 'blogs' || contentType === 'all') && !blogBackupEnabled && (
        <div className="px-3 py-2 border-t border-gray-100">
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            <span>{t('search.blogSearchLimited')}</span>
            {onOpenBlogSettings && (
              <button
                onClick={onOpenBlogSettings}
                className="underline font-medium hover:text-amber-900 whitespace-nowrap"
              >
                {t('search.enableFullBackup')}
              </button>
            )}
          </div>
        </div>
      )}

    </div>
  );
};
