import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { getServicePrimaryColor, getServiceDisplayName } from '../../../data/services';
import { formatName } from '../../../utils';
import type { FilterChip, DateRangePreset, MembersResponse } from '../types';

interface SearchFilterBarProps {
  selectedFilters: FilterChip[];
  onFiltersChange: (filters: FilterChip[]) => void;
  exactOnly: boolean;
  onExactOnlyChange: (value: boolean) => void;
  includeUnread: boolean;
  onIncludeUnreadChange: (value: boolean) => void;
  dateRange: DateRangePreset;
  onDateRangeChange: (preset: DateRangePreset) => void;
}

const DATE_PRESETS: { value: DateRangePreset; labelKey: string }[] = [
  { value: 'all', labelKey: 'search.allTime' },
  { value: '7d', labelKey: 'search.last7Days' },
  { value: '30d', labelKey: 'search.last30Days' },
  { value: '3m', labelKey: 'search.last3Months' },
  { value: '1y', labelKey: 'search.lastYear' },
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
}) => {
  const { t } = useTranslation();
  const [mentionQuery, setMentionQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [membersData, setMembersData] = useState<MembersResponse | null>(null);
  const mentionInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dateDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch members for autocomplete on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/search/members')
      .then(r => r.json())
      .then((data: MembersResponse) => {
        if (!cancelled) setMembersData(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(e.target as Node)) {
        setShowDateDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Filter dropdown items based on query and already-selected chips
  const filteredItems = useMemo(() => {
    if (!membersData) return [];
    const q = mentionQuery.toLowerCase().replace(/^@/, '');
    const selectedIds = new Set(selectedFilters.map(f => f.id));

    const items: { type: 'service' | 'member'; id: string; label: string; sublabel?: string; color: string }[] = [];

    // Services
    for (const svc of membersData.services) {
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

    // Members — consolidate by (service, member_id) since same member can appear in multiple groups
    const seen = new Set<string>();
    for (const mem of membersData.members) {
      const dedup = `${mem.service}:${mem.member_id}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      const id = `${mem.service}:${mem.member_id}`;
      if (selectedIds.has(id)) continue;
      const name = formatName(mem.member_name);
      const color = getServicePrimaryColor(mem.service);
      if (!q || name.toLowerCase().includes(q) || mem.member_name.toLowerCase().includes(q)) {
        items.push({
          type: 'member',
          id,
          label: name,
          sublabel: getServiceDisplayName(mem.service),
          color,
        });
      }
    }

    return items.slice(0, 20); // Cap at 20 suggestions
  }, [membersData, mentionQuery, selectedFilters]);

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
    <div className="border-b border-gray-200 bg-gray-50/50">
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
              <div className="absolute left-0 top-full mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-48 overflow-y-auto">
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

        {/* Date range dropdown */}
        <div className="relative ml-auto" ref={dateDropdownRef}>
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
    </div>
  );
};
