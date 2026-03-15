import React, { useMemo } from 'react';
import { Search, Loader2, X, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import type { ContentTypeFilter } from '../types';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  isLoading: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onFilterToggle?: () => void;
  filtersActive?: boolean;
  contentType?: ContentTypeFilter;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  isLoading,
  inputRef,
  onCompositionStart,
  onCompositionEnd,
  onFilterToggle,
  filtersActive,
  contentType = 'all',
}) => {
  const { t } = useTranslation();

  const placeholder = useMemo(() => {
    switch (contentType) {
      case 'messages': return t('search.placeholderMessages');
      case 'blogs': return t('search.placeholderBlogs');
      default: return t('search.placeholder');
    }
  }, [contentType, t]);

  const isMac = useMemo(
    () => navigator.platform.toUpperCase().includes('MAC'),
    []
  );

  return (
    <div className="flex items-center px-4 py-3 rounded-t-xl">
      <Search className="w-5 h-5 text-gray-400 shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        placeholder={placeholder}
        className="flex-1 ml-3 text-base bg-transparent outline-none placeholder-gray-400"
        autoFocus
      />
      {/* Filter toggle */}
      {onFilterToggle && (
        <button
          type="button"
          onClick={onFilterToggle}
          className={`shrink-0 ml-1 p-1 rounded transition-colors ${
            filtersActive
              ? 'text-blue-600 bg-blue-50'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
          title="Filters"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
      )}
      <div className="shrink-0 ml-2">
        {isLoading ? (
          <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
        ) : value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <kbd className="px-1.5 py-0.5 text-xs text-gray-400 bg-gray-100 border border-gray-200 rounded font-mono">
            {isMac ? '\u2318K' : 'Ctrl+K'}
          </kbd>
        )}
      </div>
    </div>
  );
};
