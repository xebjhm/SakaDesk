export interface MessageSearchResult {
  result_type: 'message';
  message_id: number;
  content: string | null;
  snippet: string | null;
  service: string;
  group_id: number;
  group_name: string;
  member_id: number;
  member_name: string;
  timestamp: string;
  type: string;
  is_group_chat?: boolean;
}

export interface BlogSearchResult {
  result_type: 'blog';
  blog_id: string;
  title: string;
  snippet: string | null;
  service: string;
  member_id: number;
  member_name: string;
  published_at: string;
  blog_url: string;
}

export type SearchResult = MessageSearchResult | BlogSearchResult;

export type ContentTypeFilter = 'all' | 'messages' | 'blogs';

export interface SearchResponse {
  query: string;
  normalized_query: string;
  total_count: number;
  results: SearchResult[];
  has_more: boolean;
}

export interface FilterChip {
  type: 'service' | 'member';
  id: string;
  label: string;
  color: string;
}

export type DateRangePreset = 'all' | '7d' | '30d' | '3m' | '1y';

export interface MemberEntry {
  service: string;
  group_id: number;
  group_name: string;
  member_id: number;
  member_name: string;
  message_count: number;
}

export interface ServiceEntry {
  service: string;
  member_count: number;
  message_count: number;
}

export interface MembersResponse {
  members: MemberEntry[];
  services: ServiceEntry[];
}
