import React, { useEffect } from 'react';
import { useTranslation } from '../../../i18n';
import { SearchResultItem } from './SearchResultItem';
import type { SearchResult } from '../types';

interface SearchResultListProps {
  results: SearchResult[];
  selectedIndex: number;
  onSelect: (result: SearchResult) => void;
  onHover: (index: number) => void;
  listId: string;
  listRef: React.RefObject<HTMLDivElement>;
  userNicknames?: Record<string, string>;
}

export const SearchResultList: React.FC<SearchResultListProps> = ({
  results,
  selectedIndex,
  onSelect,
  onHover,
  listId,
  listRef,
  userNicknames,
}) => {
  const { t } = useTranslation();

  // Auto-scroll selected item into view
  useEffect(() => {
    if (selectedIndex < 0 || !listRef.current) return;

    const container = listRef.current;
    const selectedElement = container.children[selectedIndex] as HTMLElement | undefined;
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, listRef]);

  return (
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label={t('search.resultsLabel')}
      className="max-h-[calc(60vh-120px)] overflow-y-auto px-2 py-1"
    >
      {results.map((result, index) => (
        <SearchResultItem
          key={result.result_type === 'message' ? result.message_id : result.blog_id}
          result={result}
          index={index}
          optionId={`${listId}-${index}`}
          isSelected={index === selectedIndex}
          onSelect={onSelect}
          onHover={onHover}
          userNickname={userNicknames?.[result.service]}
        />
      ))}
    </div>
  );
};
