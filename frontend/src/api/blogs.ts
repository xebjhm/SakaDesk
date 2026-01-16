// frontend/src/api/blogs.ts
import { BlogMembersResponse, BlogListResponse, BlogContentResponse, RecentPostsResponse } from '../types';

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
