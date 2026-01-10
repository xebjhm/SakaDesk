import React from 'react';
import { Message } from '../types';
import { cn } from '../lib/utils';
import { VoicePlayer } from './VoicePlayer';
import { Video, MessageSquare, Volume2, Image as ImageIcon } from 'lucide-react';

interface MessageBubbleProps {
    message: Message;
    member_name: string;
    member_avatar?: string;
    api_base?: string;
    isUnread?: boolean;
    onReveal?: () => void;
    onLongPress?: () => void;
}

const SHELTER_COLORS = {
    video: '#c4a8d8',    // lavender/purple
    text: '#8bb8d6',     // light blue
    voice: '#b8a8d8',    // light purple
    picture: '#a8d0e8',  // sky blue
};

const SHELTER_ICONS = {
    video: Video,
    text: MessageSquare,
    voice: Volume2,
    picture: ImageIcon,
};

// URL regex pattern for detecting links in text
const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;

// Component to render text with clickable URLs
const LinkifiedText: React.FC<{ text: string }> = ({ text }) => {
    const parts = text.split(URL_REGEX);

    return (
        <>
            {parts.map((part, index) => {
                if (URL_REGEX.test(part)) {
                    // Reset regex lastIndex since we're using global flag
                    URL_REGEX.lastIndex = 0;
                    return (
                        <a
                            key={index}
                            href={part}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 hover:underline break-all"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {part}
                        </a>
                    );
                }
                return <span key={index}>{part}</span>;
            })}
        </>
    );
};

const MessageBubbleComponent: React.FC<MessageBubbleProps> = ({
    message,
    member_name,
    member_avatar,
    api_base = "/api/content/media",
    isUnread = false,
    onReveal,
    onLongPress
}) => {
    const date = new Date(message.timestamp);
    const dateStr = `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;

    // Fix media URL: simple concatenation might break with special chars, but typically
    // we assume media_file is a safe path from backend. Using encodeURIComponent on components
    // might be safer if the path is not already URL-safe.
    // However, backend stores relative paths like "Group/Member/file".
    // We should encode message.media_file content if it contains characters like spaces or kanji.
    // But typically browser's fetch/img src handles raw utf-8 path just fine if server supports it.
    // The issue "cannot shown properly" might be due to spaces in path not being encoded?
    // Let's safe encode the path.
    const mediaUrl = message.media_file
        ? `${api_base}/${message.media_file.split('/').map(encodeURIComponent).join('/')}`
        : null;

    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    const handleTouchStart = () => { if (isUnread && onLongPress) longPressTimer = setTimeout(onLongPress, 600); };
    const handleTouchEnd = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };

    const ShelterOverlay = () => {
        const type = message.type;
        const color = SHELTER_COLORS[type] || SHELTER_COLORS.text;
        const Icon = SHELTER_ICONS[type] || MessageSquare;

        return (
            <div
                className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer transition-colors rounded-2xl"
                style={{ backgroundColor: color }}
                onClick={(e) => {
                    e.stopPropagation();
                    onReveal?.();
                }}
                onMouseDown={handleTouchStart}
                onMouseUp={handleTouchEnd}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
            >
                <Icon className="w-8 h-8 text-white/90" />
            </div>
        );
    };

    return (
        <div className="flex gap-3 mb-6 relative">
            {/* Avatar */}
            <div className="flex-shrink-0">
                <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden">
                    {member_avatar ? (
                        <img
                            src={member_avatar}
                            alt={member_name}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs font-medium">
                            {member_name.substring(0, 2)}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex flex-col max-w-[80%]">
                {/* Metadata */}
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm text-gray-700 font-medium">{member_name}</span>
                    <span className="text-xs text-gray-400">{dateStr}</span>
                </div>

                {/* Bubble Container */}
                <div className="relative">
                    {isUnread && <ShelterOverlay />}

                    <div className={cn(
                        "bg-white rounded-2xl shadow-sm border border-gray-100 transition-all duration-300",
                        message.type === 'voice' ? "p-0 overflow-visible" : "p-3 overflow-hidden",
                        isUnread && "opacity-0 pointer-events-none" // Hide content but keep layout
                    )}>

                        {/* Picture */}
                        {message.type === 'picture' && mediaUrl && (
                            <div className="rounded-lg overflow-hidden mb-2 min-h-[200px] bg-gray-50 flex items-center justify-center">
                                <img
                                    src={mediaUrl}
                                    alt="Attachment"
                                    className="w-full h-auto object-contain max-h-[500px]"
                                />
                            </div>
                        )}

                        {/* Video */}
                        {message.type === 'video' && mediaUrl && (
                            <div className="rounded-lg overflow-hidden mb-2 bg-black min-h-[200px]">
                                <video
                                    src={mediaUrl}
                                    className="w-full max-h-[500px] object-contain"
                                    controls
                                    playsInline
                                    preload="metadata"
                                />
                            </div>
                        )}

                        {/* Voice */}
                        {message.type === 'voice' && mediaUrl && (
                            <VoicePlayer src={mediaUrl} />
                        )}

                        {/* Text */}
                        {message.content && (
                            <div className={cn(
                                "text-gray-900 whitespace-pre-wrap leading-relaxed text-[15px]",
                                message.type === 'voice' && "p-3 pt-2"
                            )}>
                                <LinkifiedText text={message.content} />
                            </div>
                        )}

                        {/* Fallback for missing content */}
                        {!message.content && !mediaUrl && (
                            <div className="text-gray-400 italic text-sm">
                                (No content)
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export const MessageBubble = React.memo(MessageBubbleComponent);
