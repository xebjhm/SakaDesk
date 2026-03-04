import React, { useEffect } from 'react';
import { SearchResultItem } from './SearchResultItem';
import type { SearchResult } from '../types';

interface SearchResultListProps {
  results: SearchResult[];
  selectedIndex: number;
  onSelect: (result: SearchResult) => void;
  onMouseEnterItem: (index: number) => void;
  listRef: React.RefObject<HTMLDivElement>;
  userNicknames?: Record<string, string>;
  userNickname?: string;
}

export const SearchResultList: React.FC<SearchResultListProps> = ({
  results,
  selectedIndex,
  onSelect,
  onMouseEnterItem,
  listRef,
  userNicknames,
  userNickname,
}) => {
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
      className="overflow-y-auto max-h-[calc(60vh-120px)]"
    >
      {results.map((result, index) => (
        <SearchResultItem
          key={result.result_type === 'message' ? result.message_id : result.blog_id}
          result={result}
          isSelected={index === selectedIndex}
          onSelect={onSelect}
          onMouseEnter={() => onMouseEnterItem(index)}
          userNickname={userNicknames?.[result.service] || userNickname}
        />
      ))}
    </div>
  );
};
