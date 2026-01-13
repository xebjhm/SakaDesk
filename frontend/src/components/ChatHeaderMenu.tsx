import React, { useState } from 'react';
import { MoreVertical, Mail, Image, Calendar, Palette, Star } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Message } from '../types';
import { SentLettersModal } from './SentLettersModal';
import { MediaGalleryModal } from './MediaGalleryModal';

interface ChatHeaderMenuProps {
    conversationPath: string;
    isGroupChat: boolean;
    messages: Message[];
    memberName: string;
    groupId?: string;
}

type ModalType = 'letters' | 'media' | 'calendar' | 'background' | 'favorites' | null;

export const ChatHeaderMenu: React.FC<ChatHeaderMenuProps> = ({
    conversationPath,
    isGroupChat,
    messages,
    memberName,
    groupId,
}) => {
    const [showMenu, setShowMenu] = useState(false);
    const [activeModal, setActiveModal] = useState<ModalType>(null);

    const menuItems = [
        { id: 'calendar' as ModalType, icon: Calendar, label: '日期搜索', enabled: true },
        { id: 'favorites' as ModalType, icon: Star, label: '収藏夾', enabled: true },
        { id: 'media' as ModalType, icon: Image, label: '媒体', enabled: true },
        { id: 'background' as ModalType, icon: Palette, label: '背景図案', enabled: true },
        { id: 'letters' as ModalType, icon: Mail, label: '已发送信件', enabled: !isGroupChat },
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
            />

            {/* TODO: Calendar, Background, Favorites modals */}
        </>
    );
};
