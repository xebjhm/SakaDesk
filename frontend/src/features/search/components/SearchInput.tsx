import React, { useMemo } from 'react';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import { IconButton, Spinner } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
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
  /** The field's keys (↑ / ↓ / Enter over the results); the dialog keeps every other control's keys. */
  onKeyDown: React.KeyboardEventHandler<HTMLInputElement>;
  /** Id of the results listbox the field controls. */
  listId: string;
  /** Id of the highlighted option (aria-activedescendant), when there is one. */
  activeId?: string;
  /** True while results are listed. */
  expanded: boolean;
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
  onKeyDown,
  listId,
  activeId,
  expanded,
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
    <div className="flex items-center gap-3 px-4 py-3">
      <Search aria-hidden="true" className="h-5 w-5 shrink-0 text-muted" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={activeId}
        onKeyDown={onKeyDown}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-title text-primary outline-none placeholder:text-muted"
      />
      {onFilterToggle && (
        <IconButton
          size="sm"
          aria-label={t('search.filters')}
          title={t('search.filters')}
          aria-pressed={filtersActive}
          className={cn(filtersActive && 'bg-accent-subtle text-accent-strong')}
          icon={<SlidersHorizontal className="h-4 w-4" />}
          onClick={onFilterToggle}
        />
      )}
      {isLoading ? (
        <Spinner size="sm" tone="muted" decorative className="shrink-0" />
      ) : value ? (
        <IconButton size="sm" aria-label={t('common.close')} icon={<X className="h-4 w-4" />} onClick={() => onChange('')} />
      ) : (
        <kbd className="shrink-0 rounded-pill bg-sunken px-2 py-1 font-mono text-caption text-muted">{isMac ? '\u2318K' : 'Ctrl+K'}</kbd>
      )}
    </div>
  );
};
