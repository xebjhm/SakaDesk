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

export interface GroupAuthStatus {
    is_authenticated: boolean;
    group_name: string;
    username?: string;
    error?: string;
}

export type MultiGroupAuthStatus = Record<string, GroupAuthStatus>;
