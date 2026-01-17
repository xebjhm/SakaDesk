import React, { useState } from 'react';
import { MoreVertical, Mail, Image, Calendar, Palette, Star } from 'lucide-react';
import { cn } from '../../../utils/classnames';
import type { Message, BackgroundSettings } from '../../../types';
import { SentLettersModal } from '../../../core/modals/SentLettersModal';
import { MediaGalleryModal } from '../../../core/media/MediaGalleryModal';
import { CalendarModal } from '../../../core/modals/CalendarModal';
import { BackgroundModal } from '../../../core/modals/BackgroundModal';
import { FavoritesModal } from '../../../core/modals/FavoritesModal';

// Re-export for backward compatibility
export type { BackgroundSettings } from '../../../types';

interface ChatHeaderMenuProps {
    conversationPath: string;
    isGroupChat: boolean;
    messages: Message[];
    memberName: string;
    memberAvatar?: string;
    groupId?: string;
    onSelectDate?: (date: string) => void;
    onBackgroundChange?: (settings: BackgroundSettings) => void;
}

type ModalType = 'letters' | 'media' | 'calendar' | 'background' | 'favorites' | null;

export const ConversationMenu: React.FC<ChatHeaderMenuProps> = ({
    conversationPath,
    isGroupChat,
    messages,
    memberName,
    memberAvatar,
    groupId,
    onSelectDate,
    onBackgroundChange,
}) => {
    const [showMenu, setShowMenu] = useState(false);
    const [activeModal, setActiveModal] = useState<ModalType>(null);

    const menuItems = [
        { id: 'calendar' as ModalType, icon: Calendar, label: 'Date Search', enabled: true },
        { id: 'favorites' as ModalType, icon: Star, label: 'Favorites', enabled: true },
        { id: 'media' as ModalType, icon: Image, label: 'Media', enabled: true },
        { id: 'background' as ModalType, icon: Palette, label: 'Background', enabled: true },
        { id: 'letters' as ModalType, icon: Mail, label: 'Sent Letters', enabled: !isGroupChat },
    ];

    const handleMenuItemClick = (modalType: ModalType) => {
        setShowMenu(false);
        setActiveModal(modalType);
    };

    return (
        <>
            {/* Three-dot menu button */}
            <div className="relative">
                <button
                    onClick={() => setShowMenu(!showMenu)}
                    className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title="More options"
                >
                    <MoreVertical className="w-5 h-5" />
                </button>

                {/* Dropdown menu */}
                {showMenu && (
                    <>
                        {/* Clickaway overlay */}
                        <div
                            className="fixed inset-0 z-40"
                            onClick={() => setShowMenu(false)}
                        />
                        {/* Menu */}
                        <div className="absolute right-0 top-full mt-1 bg-white shadow-xl rounded-lg border border-gray-100 py-1 w-48 z-50">
                            {menuItems.map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => item.enabled && handleMenuItemClick(item.id)}
                                    disabled={!item.enabled}
                                    className={cn(
                                        "w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors",
                                        item.enabled
                                            ? "text-gray-700 hover:bg-gray-50"
                                            : "text-gray-300 cursor-not-allowed"
                                    )}
                                >
                                    <item.icon className="w-4 h-4" />
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Modals */}
            <SentLettersModal
                isOpen={activeModal === 'letters'}
                onClose={() => setActiveModal(null)}
                conversationPath={conversationPath}
                memberName={memberName}
                groupId={groupId}
            />

            <MediaGalleryModal
                isOpen={activeModal === 'media'}
                onClose={() => setActiveModal(null)}
                messages={messages}
                memberName={memberName}
                memberAvatar={memberAvatar}
            />

            <CalendarModal
                isOpen={activeModal === 'calendar'}
                onClose={() => setActiveModal(null)}
                conversationPath={conversationPath}
                onSelectDate={(date) => {
                    onSelectDate?.(date);
                    setActiveModal(null);
                }}
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
            />
        </>
    );
};
