export interface MemberInfo {
    id: number | string;
    name: string;
    group_id?: number;
    portrait?: string;
    thumbnail?: string;
    phone_image?: string;
    group_thumbnail?: string;
    dir_name?: string;
    path?: string;  // Full path to member directory from output_dir
}

export interface Member {
    id: number;
    name: string;
    group_id: number;
}

export interface Message {
    id: number;
    timestamp: string; // ISO
    type: 'text' | 'picture' | 'video' | 'voice';
    is_favorite: boolean;
    content: string | null;
    media_file?: string;
    width?: number;  // Media dimensions (for picture/video)
    height?: number;
    media_duration?: number;  // Duration in seconds (for video/voice)
    is_muted?: boolean;  // Whether video has no audio
    _raw_type?: string;
}

export interface MessagesResponse {
    exported_at: string;
    member: MemberInfo;
    total_messages: number;
    message_type_counts: Record<string, number>;
    messages: Message[];
}

export interface Group {
    id: string;
    name: string;
    dir_name: string;
    group_path: string;  // Full path to group directory from output_dir
    member_count: number;
    is_group_chat: boolean;
    is_active: boolean;
    thumbnail?: string;
    members: MemberInfo[];
    service?: string;
    last_message_id?: number;
    total_messages?: number;
}

export interface ServiceAuthStatus {
    authenticated: boolean;
    token_expired?: boolean;
    app_id?: string;
    storage_type?: string;
    message?: string;
}

export type MultiGroupAuthStatus = Record<string, ServiceAuthStatus>;

// Blog types - matching backend/api/blogs.py responses
export interface BlogMember {
    id: string;
    name: string;
}

export interface BlogMemberWithThumbnail {
    id: string;
    name: string;
    thumbnail: string | null;  // Local filename or null
}

export interface BlogMembersResponse {
    service: string;
    members: BlogMember[];
}

export interface BlogMembersWithThumbnailsResponse {
    service: string;
    members: BlogMemberWithThumbnail[];
}

export interface BlogMeta {
    id: string;
    title: string;
    published_at: string;  // ISO datetime
    url: string;
    thumbnail: string | null;
    cached: boolean;
}

export interface BlogListResponse {
    member_id: string;
    member_name: string;
    blogs: BlogMeta[];
}

export interface BlogContentResponse {
    meta: {
        id: string;
        member_name: string;
        title: string;
        published_at: string;
        url: string;
    };
    content: {
        html: string;
    };
    images: Array<{
        original_url: string;
        local_path: string | null;
    }>;
}

export interface RecentPost {
    id: string;
    title: string;
    published_at: string;
    url: string;
    thumbnail: string | null;
    member_id: string;
    member_name: string;
}

export interface RecentPostsResponse {
    service: string;
    posts: RecentPost[];
}

// Chat background customization types
export interface BackgroundSettings {
    type: 'default' | 'color' | 'image';
    imageData?: string;  // Base64 encoded image
    color: string;
    opacity: number;
}
