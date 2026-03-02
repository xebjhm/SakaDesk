export interface SearchResult {
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
}

export interface SearchResponse {
  query: string;
  normalized_query: string;
  total_count: number;
  results: SearchResult[];
  has_more: boolean;
}
