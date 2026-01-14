// frontend/src/api/blogs.ts
import { BlogMembersResponse, BlogListResponse, BlogContentResponse } from '../types';

const API_BASE = '/api/blogs';

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
