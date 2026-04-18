import React, { useState } from 'react';
import { MoreVertical, Mail, Image, Calendar, Palette, Star } from 'lucide-react';
import { cn } from '../../../utils/classnames';
import type { Message, BackgroundSettings } from '../../../types';
import { SentLettersModal } from '../../../core/modals/SentLettersModal';
import { MediaGalleryModal } from '../../../core/media/MediaGalleryModal';
import { CalendarModal } from '../../../core/modals/CalendarModal';
import { BackgroundModal } from '../../../core/modals/BackgroundModal';
import { FavoritesModal } from '../../../core/modals/FavoritesModal';
import { useAppStore } from '../../../store/appStore';
import { getServiceTheme } from '../../../config/serviceThemes';
import { useTranslation } from '../../../i18n';

// Re-export for backward compatibility
export type { BackgroundSettings } from '../../../types';

interface ChatHeaderMenuProps {
    conversationPath: string;
    isGroupChat: boolean;
    messages: Message[];
    memberName: string;
    memberAvatar?: string;
    groupId?: string;
    activeService?: string; // Service ID for API calls
    onSelectDate?: (date: string) => void;
    onBackgroundChange?: (settings: BackgroundSettings) => void;
    /** Icon color for header (used in light header style) */
    iconColor?: string;
}

type ModalType = 'letters' | 'media' | 'calendar' | 'background' | 'favorites' | null;

export const ConversationMenu: React.FC<ChatHeaderMenuProps> = ({
    conversationPath,
    isGroupChat,
    messages,
    memberName,
    memberAvatar,
    groupId,
    activeService,
    onSelectDate,
    onBackgroundChange,
    iconColor,
}) => {
    const { t } = useTranslation();
    const [showMenu, setShowMenu] = useState(false);
    const [activeModal, setActiveModal] = useState<ModalType>(null);

    // Get per-service theme colors
    const currentService = useAppStore((state) => state.activeService);
    const theme = getServiceTheme(currentService);

    const menuItems = [
        { id: 'calendar' as ModalType, icon: Calendar, label: t('conversationMenu.dateSearch'), enabled: true },
        { id: 'favorites' as ModalType, icon: Star, label: t('conversationMenu.favorites'), enabled: true },
        { id: 'media' as ModalType, icon: Image, label: t('conversationMenu.media'), enabled: true },
        { id: 'background' as ModalType, icon: Palette, label: t('conversationMenu.background'), enabled: true },
        { id: 'letters' as ModalType, icon: Mail, label: t('conversationMenu.sentLetters'), enabled: !isGroupChat },
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
                    className={cn(
                        "p-2 rounded-lg transition-colors",
                        iconColor ? "hover:bg-black/5" : "text-white/80 hover:text-white hover:bg-white/10"
                    )}
                    style={iconColor ? { color: iconColor } : undefined}
                    title={t('common.moreOptions')}
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
                                    <item.icon
                                        className="w-4 h-4"
                                        style={item.enabled ? { color: theme.modals.accentColor } : undefined}
                                    />
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
                activeService={activeService}
            />

            <MediaGalleryModal
                isOpen={activeModal === 'media'}
                onClose={() => setActiveModal(null)}
                messages={messages}
                memberName={memberName}
                memberAvatar={memberAvatar}
                serviceId={activeService}
                memberPath={conversationPath}
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
                serviceId={activeService}
            />
        </>
    );
};
