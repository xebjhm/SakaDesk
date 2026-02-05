// frontend/src/features/blogs/api.ts
import type { BlogMembersResponse, BlogListResponse, BlogContentResponse, RecentPostsResponse, BlogMembersWithThumbnailsResponse } from '../../types';

const API_BASE = '/api/blogs';

export async function getRecentPosts(
    service: string,
    limit: number = 20,
    memberIds?: string[]
): Promise<RecentPostsResponse> {
    const params = new URLSearchParams({
        service,
        limit: limit.toString(),
    });
    if (memberIds && memberIds.length > 0) {
        params.set('member_ids', memberIds.join(','));
    }
    const res = await fetch(`${API_BASE}/recent?${params}`);
    if (!res.ok) {
        throw new Error(`Failed to fetch recent posts: ${res.status}`);
    }
    return res.json();
}

export async function getBlogMembers(service: string): Promise<BlogMembersResponse> {
    const res = await fetch(`${API_BASE}/members?service=${encodeURIComponent(service)}`);
    if (!res.ok) {
        throw new Error(`Failed to fetch blog members: ${res.status}`);
    }
    return res.json();
}

export async function getBlogMembersWithThumbnails(service: string): Promise<BlogMembersWithThumbnailsResponse> {
    const res = await fetch(`${API_BASE}/members-with-thumbnails?service=${encodeURIComponent(service)}`);
    if (!res.ok) {
        throw new Error(`Failed to fetch blog members with thumbnails: ${res.status}`);
    }
    return res.json();
}

export function getMemberThumbnailUrl(service: string, memberId: string): string {
    return `${API_BASE}/member-thumbnail/${encodeURIComponent(service)}/${encodeURIComponent(memberId)}`;
}

export async function getBlogList(
    service: string,
    memberId: string
): Promise<BlogListResponse> {
    const params = new URLSearchParams({
        service,
        member_id: memberId,
    });
    const res = await fetch(`${API_BASE}/list?${params}`);
    if (!res.ok) {
        throw new Error(`Failed to fetch blog list: ${res.status}`);
    }
    return res.json();
}

export async function getBlogContent(
    service: string,
    blogId: string
): Promise<BlogContentResponse> {
    const params = new URLSearchParams({
        service,
        blog_id: blogId,
    });
    const res = await fetch(`${API_BASE}/content?${params}`);
    if (!res.ok) {
        throw new Error(`Failed to fetch blog content: ${res.status}`);
    }
    return res.json();
}

export interface BlogSyncResponse {
    status: string;
    service: string;
    total_members: number;
    total_blogs: number;
    last_sync: string;
}

/**
 * Sync blog metadata from official website.
 * This fetches fresh blog data - does NOT require authentication.
 */
export async function syncBlogMetadata(service: string): Promise<BlogSyncResponse> {
    const res = await fetch(`${API_BASE}/sync?service=${encodeURIComponent(service)}`, {
        method: 'POST',
    });
    if (!res.ok) {
        throw new Error(`Failed to sync blog metadata: ${res.status}`);
    }
    return res.json();
}
