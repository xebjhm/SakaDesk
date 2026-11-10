import React, { useMemo, useState } from 'react';
import { useTranslation } from '../../../i18n';
import { MessageBubble } from '../../messages/components/MessageBubble';
import { replaceNickname } from '../../messages/utils/nickname';
import { resizedAvatarUrl } from '../../messages/mediaUrl';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';
import { MediaViewerModal, type MediaViewerItem } from '../../../core/media/PhotoDetailModal';
import { getServiceDisplayName, getServicePrimaryColor } from '../../../data/services';
import { groupMarkerStyle } from '../../search/groupMarker';
import { MemoryText } from '../shared/MemoryText';
import { useNickname } from '../shared/useNickname';
import { toChatMessage } from '../shared/toMessage';
import { jumpToChat } from '../shared/jumpToChat';
import { memoryMediaSrc } from '../shared/mediaSrc';
import { contextCaption, shownTexts } from '../shared/captions';
import { JST_TIME_ZONE } from '../recap/availability';
import type { DayPerson } from './people';
import type { DayMessage, MemoryMessage } from '../types';

interface MergedTimelineProps {
    /** The day's messages in time order (already filtered). */
    messages: DayMessage[];
    /** Everyone of the day, by `person_key` (`people.ts`). */
    people: Map<string, DayPerson>;
    /** The active service: messages of any other one carry a group label. */
    service: string;
}

/** Same sender within this long continues a run (the chat's rule). */
const RUN_GAP_MS = 5 * 60 * 1000;
const AVATAR_PX = 40;

const msgKey = (m: DayMessage) => `${m.service}|${m.room}|${m.id}`;
const isViewable = (m: DayMessage) => (m.type === 'picture' || m.type === 'video') && Boolean(m.media_url || m.media_file);
/** Only called for viewable items, which have a URL or a file. */
const mediaSrc = (m: MemoryMessage) => memoryMediaSrc(m) ?? '';

/** Space for the bubble's avatar column, so lines under a bubble align with it. */
const Indented: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="flex gap-3">
        <span aria-hidden="true" className="w-10 shrink-0" />
        <div className="min-w-0">{children}</div>
    </div>
);

/**
 * 那一天 A: every message of the day in time order as the chat's `MessageBubble` in `readOnly`
 * mode (no context menu, long-press or favourite actions; translate and the transcript work
 * through `memberPath`), times on the JST clock, her words through the nickname (or the mask), a
 * picture's paired words under it with `MemoryText` (unless their own message is in the list, so
 * they show once). Pictures and videos open the media viewer
 * over the day's media, whose source link opens her chat at that message.
 */
export const MergedTimeline: React.FC<MergedTimelineProps> = ({ messages, people, service }) => {
    const { t } = useTranslation();
    const ownNickname = useNickname();
    const nickname = ownNickname ?? `『${t('memories.common.nicknameMasked')}』`;
    const avatarWidth = useAvatarWidth(AVATAR_PX);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);

    const nameOf = (m: DayMessage) => people.get(m.person_key)?.name ?? '';
    const media = useMemo(() => messages.filter(isViewable), [messages]);
    const shown = useMemo(() => shownTexts(messages), [messages]);
    const mediaItems: MediaViewerItem[] = media.map((m) => ({
        src: mediaSrc(m),
        type: m.type as 'picture' | 'video',
        timestamp: m.ts,
        memberName: nameOf(m),
        sourceLabel: t('memories.common.jumpToChat'),
        onSourceJump: () => {
            setViewerIndex(null);
            jumpToChat(m, nameOf(m), 'day');
        },
        messageId: m.id,
        service: m.service,
    }));

    return (
        <div data-testid="day-merged" className="flex flex-col pb-4">
            {messages.map((m, i) => {
                const prev = messages[i - 1];
                const runStart = !prev
                    || prev.person_key !== m.person_key
                    || Date.parse(m.ts) - Date.parse(prev.ts) > RUN_GAP_MS;
                const person = people.get(m.person_key);
                const chat = toChatMessage(m);
                chat.content = m.text ? replaceNickname(m.text, nickname) : null;
                const mediaIndex = media.indexOf(m);
                const caption = contextCaption(m, shown);
                return (
                    <div key={msgKey(m)}>
                        <MessageBubble
                            message={chat}
                            member_name={person?.name ?? ''}
                            member_avatar={resizedAvatarUrl(m.avatar_url ?? person?.avatarUrl, avatarWidth)}
                            service={m.service}
                            memberPath={m.member_path}
                            userNickname={ownNickname}
                            timeZone={JST_TIME_ZONE}
                            readOnly
                            runStart={runStart}
                            onMediaClick={mediaIndex >= 0 ? () => setViewerIndex(mediaIndex) : undefined}
                        />
                        {caption && (
                            <Indented>
                                <MemoryText text={caption} className="pt-1 text-body text-primary" />
                            </Indented>
                        )}
                        {m.service !== service && (
                            <Indented>
                                <span
                                    data-testid="day-service-label"
                                    className="mt-1 inline-flex items-center gap-1 rounded-pill bg-sunken px-2 text-caption text-secondary"
                                >
                                    <span
                                        aria-hidden="true"
                                        className="h-2 w-2 shrink-0 rounded-pill bg-group-marker"
                                        style={groupMarkerStyle(getServicePrimaryColor(m.service))}
                                    />
                                    <span lang="ja">{getServiceDisplayName(m.service)}</span>
                                </span>
                            </Indented>
                        )}
                    </div>
                );
            })}
            {viewerIndex !== null && mediaItems[viewerIndex] && (
                <MediaViewerModal
                    mediaItems={mediaItems}
                    currentIndex={viewerIndex}
                    onClose={() => setViewerIndex(null)}
                    onNavigate={setViewerIndex}
                />
            )}
        </div>
    );
};
