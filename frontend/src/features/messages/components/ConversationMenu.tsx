import React, { useRef, useState } from 'react';
import { MoreVertical, Mail, Image, Calendar, Palette, Star } from 'lucide-react';
import type { Message, BackgroundSettings } from '../../../types';
import type { Letter } from '../letters';
import type { LettersStatus } from '../hooks/useRoomExtras';
import { SentLettersModal } from '../../../core/modals/SentLettersModal';
import { MediaGalleryModal } from '../../../core/media/MediaGalleryModal';
import { BackgroundModal } from '../../../core/modals/BackgroundModal';
import { FavoritesModal } from '../../../core/modals/FavoritesModal';
import { useAppStore } from '../../../store/appStore';
import { useTranslation } from '../../../i18n';
import { IconButton, Menu, MenuItem } from '../../../design/primitives';

// Re-export for backward compatibility
export type { BackgroundSettings } from '../../../types';

interface ChatHeaderMenuProps {
    conversationPath: string;
    isGroupChat: boolean;
    messages: Message[];
    memberName: string;
    memberAvatar?: string;
    activeService?: string; // Service ID for API calls
    /** Opens the date-search calendar (owned by MessagesFeature; the date pills open it too). */
    onOpenCalendar: () => void;
    onBackgroundChange?: (settings: BackgroundSettings) => void;
    /** The room's sent letters (the timeline's list), for the overview. */
    letters: readonly Letter[];
    /** Whether the letters are loading, loaded or unavailable (the overview says so). */
    lettersStatus: LettersStatus;
    /** Jumps the chat to a letter chosen in the overview. */
    onJumpToLetter: (id: number) => void;
}

type ModalType = 'letters' | 'media' | 'calendar' | 'background' | 'favorites' | null;

export const ConversationMenu: React.FC<ChatHeaderMenuProps> = ({
    conversationPath,
    isGroupChat,
    messages,
    memberName,
    memberAvatar,
    letters,
    lettersStatus,
    onJumpToLetter,
    activeService,
    onOpenCalendar,
    onBackgroundChange,
}) => {
    const { t } = useTranslation();
    const [showMenu, setShowMenu] = useState(false);
    const [activeModal, setActiveModal] = useState<ModalType>(null);

    const triggerRef = useRef<HTMLButtonElement>(null);
    const setTargetMessageId = useAppStore((state) => state.setTargetMessageId);

    const handleJumpToMessage = (messageId: number) => {
        setActiveModal(null);
        setShowMenu(false);
        setTargetMessageId(messageId);
    };

    const menuItems = [
        { id: 'calendar' as ModalType, icon: Calendar, label: t('conversationMenu.dateSearch'), blockedReason: undefined },
        { id: 'favorites' as ModalType, icon: Star, label: t('conversationMenu.favorites'), blockedReason: undefined },
        { id: 'media' as ModalType, icon: Image, label: t('conversationMenu.media'), blockedReason: undefined },
        { id: 'background' as ModalType, icon: Palette, label: t('conversationMenu.background'), blockedReason: undefined },
        {
            id: 'letters' as ModalType, icon: Mail, label: t('conversationMenu.sentLetters'),
            blockedReason: isGroupChat ? t('conversationMenu.sentLettersGroupChat') : undefined,
        },
    ];

    const handleMenuItemClick = (modalType: ModalType) => {
        setShowMenu(false);
        if (modalType === 'calendar') {
            onOpenCalendar();
            return;
        }
        setActiveModal(modalType);
    };

    return (
        <>
            {/* Three-dot menu button */}
            <div className="relative">
                <IconButton
                    ref={triggerRef}
                    className="h-9 w-9 text-current hover:bg-sunken hover:text-current focus-visible:ring-expressive-header focus-visible:ring-offset-0"
                    aria-label={t('common.moreOptions')}
                    title={t('common.moreOptions')}
                    aria-haspopup="menu"
                    aria-expanded={showMenu}
                    icon={<MoreVertical className="h-5 w-5" />}
                    onClick={() => setShowMenu((s) => !s)}
                />
                {showMenu && (
                    <Menu
                        aria-label={t('common.moreOptions')}
                        onClose={() => setShowMenu(false)}
                        returnFocusRef={triggerRef}
                        ignoreRefs={[triggerRef]}
                        className="absolute right-0 top-full mt-1 w-48"
                    >
                        {menuItems.map((item) => (
                            <MenuItem
                                key={item.id}
                                // Pre-D2: the menu's icons carry the group accent.
                                icon={<item.icon className="h-4 w-4 text-accent" />}
                                disabledReason={item.blockedReason}
                                logTarget={item.id === 'letters' ? 'sent_letters' : undefined}
                                onClick={() => handleMenuItemClick(item.id)}
                            >
                                {item.label}
                            </MenuItem>
                        ))}
                    </Menu>
                )}
            </div>

            {/* Modals */}
            <SentLettersModal
                isOpen={activeModal === 'letters'}
                onClose={() => setActiveModal(null)}
                letters={letters}
                status={lettersStatus}
                onSelectLetter={onJumpToLetter}
            />

            <MediaGalleryModal
                isOpen={activeModal === 'media'}
                onClose={() => setActiveModal(null)}
                messages={messages}
                memberName={memberName}
                memberAvatar={memberAvatar}
                serviceId={activeService}
                memberPath={conversationPath}
                onSourceJump={handleJumpToMessage}
            />

            <BackgroundModal
                isOpen={activeModal === 'background'}
                onClose={() => setActiveModal(null)}
                conversationPath={conversationPath}
                onSettingsChange={(settings) => {
                    onBackgroundChange?.(settings);
                }}
            />

            <FavoritesModal
                isOpen={activeModal === 'favorites'}
                onClose={() => setActiveModal(null)}
                messages={messages}
                memberName={memberName}
                memberAvatar={memberAvatar}
                serviceId={activeService}
            />
        </>
    );
};
