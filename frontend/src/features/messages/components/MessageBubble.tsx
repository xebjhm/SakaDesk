import React, { useState, useCallback, useRef } from 'react';
import type { Message } from '../../../types';
import { cn } from '../../../utils/classnames';
import { VoicePlayer } from '../../../core/media/VoicePlayer';
import { VideoPlayer } from '../../../core/media/VideoPlayer';
import { PhotoPlayer } from '../../../core/media/PhotoPlayer';
import { Video, MessageSquare, Volume2, Image as ImageIcon, Star } from 'lucide-react';
import { MessageContextMenu } from './MessageContextMenu';
import { DEFAULT_SHELTER_COLORS } from '../../../config/serviceThemes';
import { useTranslation } from '../../../i18n';
import { TranscribeButton } from '../../../core/media/TranscribeButton';
import { TranscriptPanel } from '../../../core/media/TranscriptPanel';
import { useTranscription } from '../../../hooks/useTranscription';
import { useMessageTranslation } from '../../../hooks/useMessageTranslation';
import { TranslateButton } from '../../../core/common/TranslateButton';
import { InlineTranslation } from '../../../core/common/InlineTranslation';
import { useAppStore } from '../../../store/appStore';
import { getServiceTheme } from '../../../config/serviceThemes';
import { useJustBecame } from '../../../hooks/useJustBecame';

interface ShelterColors {
    picture: string;
    video: string;
    voice: string;
    text: string;
}

type ShelterStyle = 'classic' | 'light';

interface MessageBubbleTheme {
    bubbleBorder: string;
    voicePlayerAccent: string;
    favoriteColor?: string;
    linkColor?: string;
    shelterColors?: ShelterColors;
    shelterStyle?: ShelterStyle;
}

interface MessageBubbleProps {
    message: Message;
    member_name: string;
    member_avatar?: string;
    api_base?: string;
    isUnread?: boolean;
    onReveal?: () => void;
    onLongPress?: () => void;
    onToggleFavorite?: (messageId: number, currentState: boolean) => void;
    onAvatarClick?: () => void;
    onMediaClick?: (mediaUrl: string, type: string, timestamp?: string) => void;
    theme?: MessageBubbleTheme;
    service?: string;
    /** Relative path from output_dir to the member directory (for transcription API) */
    memberPath?: string;
    /** User's nickname for %%% placeholder replacement in translations */
    userNickname?: string;
}

const SHELTER_ICONS = {
    video: Video,
    text: MessageSquare,
    voice: Volume2,
    picture: ImageIcon,
};

// URL regex pattern for detecting links in text
const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;

// Media container constraints
const MAX_MEDIA_WIDTH = 320;
const MAX_MEDIA_HEIGHT = 500;
const DEFAULT_MEDIA_HEIGHT = 200;

interface MediaContainerProps {
    message: Message;
    isVideo?: boolean;
    children: React.ReactNode;
}

/**
 * Container for media that uses pre-calculated dimensions to prevent layout jitter.
 * Falls back to default dimensions if width/height not available.
 */
const MediaContainer: React.FC<MediaContainerProps> = ({ message, isVideo = false, children }) => {
    let containerStyle: React.CSSProperties = {
        minHeight: DEFAULT_MEDIA_HEIGHT,
    };

    // If dimensions are available, calculate exact display size
    if (message.width && message.height) {
        const aspectRatio = message.width / message.height;

        // Fit within max constraints while preserving aspect ratio
        let displayWidth = Math.min(MAX_MEDIA_WIDTH, message.width);
        let displayHeight = displayWidth / aspectRatio;

        // If height exceeds max, constrain by height instead
        if (displayHeight > MAX_MEDIA_HEIGHT) {
            displayHeight = MAX_MEDIA_HEIGHT;
            displayWidth = displayHeight * aspectRatio;
        }

        containerStyle = {
            width: displayWidth,
            height: displayHeight,
        };
    }

    return (
        <div
            className={cn(
                "rounded-lg overflow-hidden mb-2 flex items-center justify-center",
                isVideo ? "bg-black" : "bg-gray-50"
            )}
            style={containerStyle}
        >
            {children}
        </div>
    );
};

// Component to render text with clickable URLs
const LinkifiedText: React.FC<{ text: string; linkColor?: string }> = ({ text, linkColor }) => {
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
                            className="hover:underline break-all"
                            style={{ color: linkColor || '#2563eb' }}
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
    onLongPress,
    onToggleFavorite,
    onAvatarClick,
    onMediaClick,
    theme,
    service,
    memberPath,
    userNickname,
}) => {
    const { t } = useTranslation();
    const date = new Date(message.timestamp);
    const dateStr = `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    // Handle right-click to show context menu
    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
    }, []);

    // Handle long press for touch devices (favorites context menu)
    const [longPressTimerFavorite, setLongPressTimerFavorite] = useState<ReturnType<typeof setTimeout> | null>(null);

    const handleTouchStartFavorite = useCallback((e: React.TouchEvent) => {
        const touch = e.touches[0];
        const timer = setTimeout(() => {
            setContextMenu({ x: touch.clientX, y: touch.clientY });
        }, 600);
        setLongPressTimerFavorite(timer);
    }, []);

    const handleTouchEndFavorite = useCallback(() => {
        if (longPressTimerFavorite) {
            clearTimeout(longPressTimerFavorite);
            setLongPressTimerFavorite(null);
        }
    }, [longPressTimerFavorite]);

    const handleToggleFavorite = useCallback(() => {
        if (onToggleFavorite) {
            onToggleFavorite(message.id, message.is_favorite);
        }
    }, [onToggleFavorite, message.id, message.is_favorite]);

    // Encode path segments for special chars (spaces, CJK characters)
    // media_file is relative to service dir (e.g., "messages/62 石森 璃花/.../voice/346492.m4a")
    // API expects full path from output dir (e.g., "櫻坂46/messages/62 石森 璃花/.../voice/346492.m4a")
    const mediaUrl = message.media_file && service
        ? `${api_base}/${encodeURIComponent(service)}/${message.media_file.split('/').map(encodeURIComponent).join('/')}`
        : null;

    // Transcription — only active for voice and non-muted video messages
    const isTranscribable = message.type === 'voice' || (message.type === 'video' && !message.is_muted);
    const {
        transcription,
        state: transcriptionState,
        trigger: triggerTranscription,
        retrigger: retriggerTranscription,
        error: transcriptionError,
    } = useTranscription(
        isTranscribable ? service : undefined,
        isTranscribable ? message.id : undefined,
        isTranscribable ? memberPath : undefined,
    );

    // Feature toggles
    const translationEnabled = useAppStore(s => s.translationEnabled);
    const transcriptionEnabled = useAppStore(s => s.transcriptionEnabled);

    // Translation — active for messages with text content
    const hasTextContent = !!message.content && message.content.trim().length > 0;
    const translationTargetLanguage = useAppStore(s => s.translationTargetLanguage) ?? 'en';
    const {
        translation,
        state: translationState,
        trigger: triggerTranslation,
        retrigger: retriggerTranslation,
        error: translationError,
    } = useMessageTranslation({
        service: hasTextContent && !isUnread ? service : undefined,
        messageId: hasTextContent && !isUnread ? message.id : undefined,
        memberPath: hasTextContent && !isUnread ? memberPath : undefined,
        targetLanguage: translationTargetLanguage,
        userNickname,
    });

    // Playback time sync between player and transcript panel
    const [playerTime, setPlayerTime] = useState(0);
    const [seekTarget, setSeekTarget] = useState<number | undefined>(undefined);

    // Auto-expand only on user-triggered completions (loading → done
    // transition). Prevents Virtuoso remounts from re-expanding cached
    // panels as messages scroll back into view.
    const transcriptionJustCompleted = useJustBecame(transcriptionState, 'done', 'loading');
    const translationJustCompleted = useJustBecame(translationState, 'done', 'loading');

    // Long press timer for shelter overlay - use ref to persist across renders
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleTouchStart = useCallback(() => {
        if (isUnread && onLongPress) {
            longPressTimerRef.current = setTimeout(onLongPress, 600);
        }
    }, [isUnread, onLongPress]);
    const handleTouchEnd = useCallback(() => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    }, []);

    const ShelterOverlay = () => {
        const type = message.type;
        const shelterColors = theme?.shelterColors || DEFAULT_SHELTER_COLORS;
        const shelterStyle = theme?.shelterStyle || 'classic';
        const themeColor = shelterColors[type as keyof ShelterColors] || shelterColors.text;
        const Icon = SHELTER_ICONS[type] || MessageSquare;

        // 'classic' = colored background with white icon (Hinatazaka, Nogizaka)
        // 'light' = white background with colored border and icon (Sakurazaka)
        const isLightStyle = shelterStyle === 'light';
        const bgColor = isLightStyle ? '#FFFFFF' : themeColor;
        const iconColor = isLightStyle ? themeColor : 'rgba(255, 255, 255, 0.9)';
        const borderStyle = isLightStyle ? `2px solid ${themeColor}` : 'none';

        return (
            <div
                className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer transition-colors rounded-2xl"
                style={{ backgroundColor: bgColor, border: borderStyle }}
                onClick={(e) => {
                    e.stopPropagation();
                    onReveal?.();
                }}
                onMouseDown={handleTouchStart}
                onMouseUp={handleTouchEnd}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
            >
                <Icon className="w-8 h-8" style={{ color: iconColor }} />
            </div>
        );
    };

    return (
        <div
            className="flex gap-3 mb-6 relative"
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStartFavorite}
            onTouchEnd={handleTouchEndFavorite}
            onTouchCancel={handleTouchEndFavorite}
        >
            {/* Context Menu */}
            {contextMenu && (
                <MessageContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    isFavorite={message.is_favorite}
                    onToggleFavorite={handleToggleFavorite}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* Avatar */}
            <div className="flex-shrink-0">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onAvatarClick?.();
                    }}
                    className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden hover:ring-2 hover:ring-blue-300 transition-all cursor-pointer"
                >
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
                </button>
            </div>

            <div className="flex flex-col max-w-[80%] group/bubble">
                {/* Metadata row — name, time, favorite star, translate button (right-aligned) */}
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm text-gray-700 font-medium">{member_name}</span>
                    <span className="text-xs text-gray-400">{dateStr}</span>
                    {message.is_favorite && (
                        <Star
                            className="w-3.5 h-3.5"
                            style={{ color: theme?.favoriteColor || '#3b82f6', fill: theme?.favoriteColor || '#3b82f6' }}
                        />
                    )}
                    {translationEnabled && hasTextContent && !isUnread && translationState !== 'done' && (
                        <div className={cn(
                            "ml-auto transition-opacity",
                            translationState === 'loading' || translationState === 'error' ? "opacity-100" : "opacity-0 group-hover/bubble:opacity-100"
                        )}>
                            <TranslateButton
                                state={translationState}
                                onClick={triggerTranslation}
                                error={translationError}
                                accentColor={service ? getServiceTheme(service).primaryColor : undefined}
                            />
                        </div>
                    )}
                </div>

                {/* Bubble Container */}
                <div className="relative">
                    {isUnread && <ShelterOverlay />}

                    <div
                        className={cn(
                            "bg-white rounded-2xl shadow-sm border transition-all duration-300",
                            message.type === 'voice' ? "p-0 overflow-visible" : "p-3 overflow-hidden",
                            isUnread && "opacity-0 pointer-events-none" // Hide content but keep layout
                        )}
                        style={{
                            borderColor: theme?.bubbleBorder || '#E5E7EB',
                        }}
                    >

                        {/* Picture */}
                        {message.type === 'picture' && mediaUrl && (
                            <MediaContainer message={message}>
                                <PhotoPlayer
                                    variant="bubble"
                                    src={mediaUrl}
                                    alt={t('messageList.attachment')}
                                    onClick={() => onMediaClick?.(mediaUrl, 'picture', message.timestamp)}
                                />
                            </MediaContainer>
                        )}

                        {/* Video */}
                        {message.type === 'video' && mediaUrl && (
                            <MediaContainer message={message} isVideo>
                                <VideoPlayer
                                    src={mediaUrl}
                                    messageTimestamp={message.timestamp}
                                    noAudio={message.is_muted}
                                    className="w-full h-full"
                                    videoClassName="w-full h-full object-contain"
                                    onTimeUpdate={setPlayerTime}
                                    seekTo={seekTarget}
                                    transcriptionSegments={transcription?.segments}
                                />
                            </MediaContainer>
                        )}

                        {/* Voice */}
                        {message.type === 'voice' && mediaUrl && (
                            <VoicePlayer
                                src={mediaUrl}
                                accentColor={theme?.voicePlayerAccent}
                                messageTimestamp={message.timestamp}
                                onTimeUpdate={setPlayerTime}
                                seekTo={seekTarget}
                            />
                        )}

                        {/* Text */}
                        {message.content && (
                            <div className={cn(
                                "text-gray-900 whitespace-pre-wrap leading-relaxed text-[15px]",
                                message.type === 'voice' && "p-3 pt-2"
                            )}>
                                <LinkifiedText text={message.content} linkColor={theme?.linkColor} />
                            </div>
                        )}

                        {/* Inline translation display */}
                        {translationEnabled && hasTextContent && !isUnread && translation && (
                            <InlineTranslation
                                translation={translation}
                                variant="message"
                                onRerun={retriggerTranslation}
                                defaultExpanded={translationJustCompleted}
                                messageId={message.id}
                            />
                        )}

                        {/* Fallback for missing content */}
                        {!message.content && !mediaUrl && (
                            <div className="text-gray-400 italic text-sm">
                                {t('messageList.noContent')}
                            </div>
                        )}
                    </div>
                </div>

                {/* Transcription footer — only for voice/video, hidden when unread shelter is active */}
                {transcriptionEnabled && isTranscribable && !isUnread && (
                    <div
                        className="rounded-b-xl border-t-0 border px-3 py-1.5 -mt-1"
                        style={{
                            borderColor: `${theme?.voicePlayerAccent || '#6da0d4'}30`,
                            background: `${theme?.voicePlayerAccent || '#6da0d4'}05`,
                        }}
                    >
                        {transcriptionState !== 'done' ? (
                            <TranscribeButton
                                state={transcriptionState}
                                onClick={triggerTranscription}
                                error={transcriptionError}
                                accentColor={theme?.voicePlayerAccent}
                                variant="dark"
                            />
                        ) : (
                            transcription && (
                                <TranscriptPanel
                                    segments={transcription.segments}
                                    currentTime={playerTime}
                                    onSeek={setSeekTarget}
                                    onRerun={retriggerTranscription}
                                    accentColor={theme?.voicePlayerAccent}
                                    variant="dark"
                                    defaultExpanded={transcriptionJustCompleted}
                                    messageId={message.id}
                                />
                            )
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export const MessageBubble = React.memo(MessageBubbleComponent);
