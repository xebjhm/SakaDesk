import React, { useState, useCallback, useRef } from 'react';
import type { Message } from '../../../types';
import { cn } from '../../../utils/classnames';
import { VoicePlayer } from '../../../core/media/VoicePlayer';
import { VideoPlayer } from '../../../core/media/VideoPlayer';
import { PhotoPlayer } from '../../../core/media/PhotoPlayer';
import { Video, MessageSquare, Volume2, Image as ImageIcon, Star } from 'lucide-react';
import { MessageContextMenu } from './MessageContextMenu';
import { useTranslation } from '../../../i18n';
import { TranscribeButton } from '../../../core/media/TranscribeButton';
import { TranscriptPanel } from '../../../core/media/TranscriptPanel';
import { useTranscription } from '../../../hooks/useTranscription';
import { useMessageTranslation } from '../../../hooks/useMessageTranslation';
import { TranslateButton } from '../../../core/common/TranslateButton';
import { InlineTranslation } from '../../../core/common/InlineTranslation';
import { useAppStore } from '../../../store/appStore';
import { useJustBecame } from '../../../hooks/useJustBecame';
import { buildMediaUrl, MEDIA_API_BASE, thumbnailUrl, type ThumbWidth } from '../mediaUrl';
import { groupTokens } from '../../../design/tokens';
import { serviceGroupId } from '../../../config/serviceGroup';
import { Avatar, SKELETON_PULSE, Spinner } from '../../../design/primitives';
import { useDelayedLoading } from '../../../design/loading';

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
    service?: string;
    /** Relative path from output_dir to the member directory (for transcription API) */
    memberPath?: string;
    /** User's nickname for %%% placeholder replacement in translations */
    userNickname?: string;
    /** First message of a run (same sender, same day, ≤ 5 min apart): shows avatar, name and time. */
    runStart?: boolean;
    /** IANA zone for the time label (Memories passes `Asia/Tokyo`); default: the machine's local clock. */
    timeZone?: string;
    /** A keepsake view (Memories): no context menu, long-press or favourite actions. Translate and transcript still work with `memberPath`. */
    readOnly?: boolean;
    /**
     * Opt-in lazy loading for the picture (Memories' read-only day lists, which are not
     * virtualised). Default: the photo's own default (`eager` for a bubble), as in the chat.
     */
    mediaLoading?: 'lazy' | 'eager';
    /**
     * Opt-in: draw the picture from the thumbnail route at this width (`thumbnailUrl`), falling
     * back to the full file on error. The click still hands the full file to `onMediaClick`, so
     * the viewer shows it. Default: the full file, as in the chat.
     */
    mediaThumbWidth?: ThumbWidth;
}

/** `HH:MM` of `date` on the local clock, or in `timeZone` when given. */
function clockLabel(date: Date, timeZone: string | undefined): string {
    if (!timeZone) return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(date);
}

const SHELTER_ICONS = {
    video: Video,
    text: MessageSquare,
    voice: Volume2,
    picture: ImageIcon,
};

type ShelterKind = 'picture' | 'video' | 'voice' | 'text';
/** Official unread shelters: `classic` = filled with a white icon, `light` = white with a coloured border and icon. */
const SHELTER_CLASSES: Record<ShelterKind, { classic: string; light: string }> = {
    picture: { classic: 'bg-group-shelter-picture text-inverse', light: 'border-2 border-group-shelter-picture bg-card text-group-shelter-picture' },
    video: { classic: 'bg-group-shelter-video text-inverse', light: 'border-2 border-group-shelter-video bg-card text-group-shelter-video' },
    voice: { classic: 'bg-group-shelter-voice text-inverse', light: 'border-2 border-group-shelter-voice bg-card text-group-shelter-voice' },
    text: { classic: 'bg-group-shelter-text text-inverse', light: 'border-2 border-group-shelter-text bg-card text-group-shelter-text' },
};
const shelterKind = (type: string): ShelterKind =>
    type === 'picture' || type === 'video' || type === 'voice' ? type : 'text';

// URL regex pattern for detecting links in text
const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;

// Media container constraints
const MAX_MEDIA_WIDTH = 320;
const MAX_MEDIA_HEIGHT = 500;
const DEFAULT_MEDIA_HEIGHT = 200;

interface MediaContainerProps {
    message: Message;
    isVideo?: boolean;
    /**
     * Picture only: the photo has not loaded yet. The box pulses (`SKELETON_PULSE` on `bg-sunken`);
     * under reduced motion, where the pulse stops, a labelled spinner shows from `reveal` instead.
     */
    pending?: boolean;
    children: React.ReactNode;
}

/**
 * Container for media that uses pre-calculated dimensions to prevent layout jitter.
 * Falls back to default dimensions if width/height not available.
 */
const MediaContainer: React.FC<MediaContainerProps> = ({ message, isVideo = false, pending = false, children }) => {
    const { t } = useTranslation();
    // After `reveal`, so a photo from the cache never flashes the spinner.
    const showSpinner = useDelayedLoading(pending);
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
            data-testid="bubble-media-box"
            className={cn(
                "relative rounded-sm overflow-hidden mb-2 flex items-center justify-center",
                isVideo ? "bg-viewer-stage" : pending ? cn("bg-sunken", SKELETON_PULSE) : "bg-elevated"
            )}
            style={containerStyle}
        >
            {children}
            {!isVideo && showSpinner && (
                // Only under reduced motion (the pulse is static there); its label then shows too.
                <div className="pointer-events-none absolute inset-0 hidden items-center justify-center motion-reduce:flex">
                    <Spinner size="sm" tone="muted" label={t('media.photoLoading')} />
                </div>
            )}
        </div>
    );
};

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
                            className="break-all text-accent-strong hover:underline"
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
    api_base = MEDIA_API_BASE,
    isUnread = false,
    onReveal,
    onLongPress,
    onToggleFavorite,
    onAvatarClick,
    onMediaClick,
    service,
    memberPath,
    userNickname,
    runStart = true,
    timeZone,
    readOnly = false,
    mediaLoading,
    mediaThumbWidth,
}) => {
    const { t } = useTranslation();
    const time = clockLabel(new Date(message.timestamp), timeZone);
    // Card radius; the first bubble of a run keeps a small top-left corner.
    const bubbleCorners = cn('rounded-card', runStart && 'rounded-tl-tail');

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
        ? buildMediaUrl(service, message.media_file, api_base)
        : null;
    const pictureThumb = mediaUrl && mediaThumbWidth !== undefined ? thumbnailUrl(mediaUrl, mediaThumbWidth) : undefined;
    // The picture (message and shown src) that has loaded or failed: a new message in this bubble,
    // or a new src for the same one, loads again, so the box never sits blank without its pulse.
    const photoKey = `${message.id}|${pictureThumb ?? mediaUrl ?? ''}`;
    const [photoSettledKey, setPhotoSettledKey] = useState<string | null>(null);
    const photoPending = photoSettledKey !== photoKey;
    const settlePhoto = useCallback(() => setPhotoSettledKey(photoKey), [photoKey]);

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
    const hasTranscriptFooter = transcriptionEnabled && isTranscribable && !isUnread;

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
        const Icon = SHELTER_ICONS[message.type] || MessageSquare;
        const look = groupTokens[serviceGroupId(service ?? null)].official.shelterStyle;
        return (
            <div
                data-testid="unread-shelter"
                className={cn(
                    'absolute inset-0 z-10 flex cursor-pointer items-center justify-center transition-colors',
                    bubbleCorners,
                    SHELTER_CLASSES[shelterKind(message.type)][look],
                )}
                onClick={(e) => {
                    e.stopPropagation();
                    onReveal?.();
                }}
                onMouseDown={handleTouchStart}
                onMouseUp={handleTouchEnd}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
            >
                <Icon className="h-8 w-8" />
            </div>
        );
    };

    const favoriteStar = message.is_favorite && (
        <Star className="h-3.5 w-3.5 shrink-0 fill-current text-semantic-star drop-shadow-sm" />
    );
    const translateButton = translationEnabled && hasTextContent && !isUnread && translationState !== 'done' && (
        <div className={cn(
            'transition-opacity duration-fast ease-standard',
            // Revealed on row hover and whenever the button (or the row) has keyboard focus
            translationState === 'loading' || translationState === 'error' ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100',
        )}>
            <TranslateButton
                state={translationState}
                onClick={triggerTranslation}
                error={translationError}
                iconOnly
            />
        </div>
    );

    return (
        <div
            className={cn('group/row relative flex gap-3', runStart ? 'pt-3' : 'pt-1')}
            onContextMenu={readOnly ? undefined : handleContextMenu}
            onTouchStart={readOnly ? undefined : handleTouchStartFavorite}
            onTouchEnd={readOnly ? undefined : handleTouchEndFavorite}
            onTouchCancel={readOnly ? undefined : handleTouchEndFavorite}
        >
            {/* Context Menu */}
            {contextMenu && !readOnly && (
                <MessageContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    isFavorite={message.is_favorite}
                    onToggleFavorite={handleToggleFavorite}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* Avatar column: the avatar shows once, at the top of a run */}
            <div className="w-10 shrink-0">
                {/* Only a clickable avatar (it opens a profile card) is a button; the room
                    author (member 0) gets no handler, so a plain, non-focusable span of the same box. */}
                {runStart && onAvatarClick && (
                    <button
                        type="button"
                        data-testid="message-avatar"
                        onClick={(e) => {
                            e.stopPropagation();
                            onAvatarClick();
                        }}
                        className="flex cursor-pointer rounded-pill transition-shadow duration-fast ease-standard hover:ring-2 hover:ring-accent-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                    >
                        <Avatar src={member_avatar} name={member_name} size="md" />
                    </button>
                )}
                {runStart && !onAvatarClick && (
                    <span data-testid="message-avatar" className="flex rounded-pill">
                        <Avatar src={member_avatar} name={member_name} size="md" />
                    </span>
                )}
            </div>

            <div className="relative flex min-w-0 max-w-[80%] flex-col">
                {/* Name, time and favorite star: once per run */}
                {runStart && (
                    <div className="mb-1 flex items-center gap-2">
                        <span lang="ja" className="text-small font-semibold text-accent-strong">{member_name}</span>
                        <time className="text-caption text-muted" dateTime={message.timestamp}>{time}</time>
                        {favoriteStar}
                    </div>
                )}

                {/* Bubble Container */}
                <div className="relative">
                    {isUnread && <ShelterOverlay />}

                    <div
                        className={cn(
                            'border border-group-bubble bg-card shadow-card transition-opacity duration-base ease-standard',
                            bubbleCorners,
                            // The footer carries the bottom radius so bubble and footer read as one shape
                            hasTranscriptFooter && 'rounded-b-none',
                            message.type === 'voice' ? 'overflow-visible p-0' : 'overflow-hidden p-3',
                            isUnread && 'pointer-events-none opacity-0', // Hide content but keep layout
                        )}
                    >

                        {/* Picture */}
                        {message.type === 'picture' && mediaUrl && (
                            <MediaContainer message={message} pending={photoPending}>
                                <PhotoPlayer
                                    variant="bubble"
                                    src={pictureThumb ?? mediaUrl}
                                    fallbackSrc={pictureThumb ? mediaUrl : undefined}
                                    loading={mediaLoading}
                                    alt={t('messageList.attachment')}
                                    onClick={() => onMediaClick?.(mediaUrl, 'picture', message.timestamp)}
                                    onLoad={settlePhoto}
                                    onError={settlePhoto}
                                />
                            </MediaContainer>
                        )}

                        {/* Video */}
                        {message.type === 'video' && mediaUrl && (
                            <MediaContainer message={message} isVideo>
                                <VideoPlayer
                                    key={mediaUrl}
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
                                key={mediaUrl}
                                src={mediaUrl}
                                messageTimestamp={message.timestamp}
                                onTimeUpdate={setPlayerTime}
                                seekTo={seekTarget}
                                joinedBelow={hasTranscriptFooter}
                                tailCorner={runStart}
                            />
                        )}

                        {/* Text */}
                        {message.content && (
                            <div lang="ja" className={cn(
                                'whitespace-pre-wrap text-body text-primary',
                                message.type === 'voice' && 'p-3 pt-2',
                            )}>
                                <LinkifiedText text={message.content} />
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
                            <div className="text-small italic text-muted">
                                {t('messageList.noContent')}
                            </div>
                        )}
                    </div>
                </div>

                {/* Transcription footer — only for voice/video, hidden when unread shelter is active */}
                {hasTranscriptFooter && (
                    <div
                        data-testid="transcript-footer"
                        className="rounded-b-card border-x border-b border-group-bubble bg-accent-subtle px-3 py-1.5"
                    >
                        {transcriptionState !== 'done' ? (
                            <TranscribeButton
                                state={transcriptionState}
                                onClick={triggerTranscription}
                                error={transcriptionError}
                                variant="dark"
                            />
                        ) : (
                            transcription && (
                                <TranscriptPanel
                                    segments={transcription.segments}
                                    noSpeech={transcription.no_speech}
                                    currentTime={playerTime}
                                    onSeek={setSeekTarget}
                                    onRerun={retriggerTranscription}
                                    variant="dark"
                                    defaultExpanded={transcriptionJustCompleted}
                                    messageId={message.id}
                                />
                            )
                        )}
                    </div>
                )}
                {/* Trailing column at the bubble's bottom-right, for every message, absolutely positioned
                    so it reserves no flow width (the bubble never reflows when the translate button unmounts): the one translate
                    icon; later bubbles of a run also get the star and the time (on hover). A run
                    start keeps star and time in its header. */}
                {(translateButton || !runStart) && (
                    <div data-testid="message-trailing" className="absolute bottom-0 left-full ml-3 flex flex-col items-start justify-end gap-1 whitespace-nowrap pb-1">
                        {!runStart && favoriteStar}
                        {translateButton}
                        {!runStart && (
                            <time
                                className="text-caption text-muted opacity-0 transition-opacity duration-fast ease-standard group-hover/row:opacity-100"
                                dateTime={message.timestamp}
                            >
                                {time}
                            </time>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export const MessageBubble = React.memo(MessageBubbleComponent);
