import React, { useEffect, useRef, useCallback } from 'react';
import { Star } from 'lucide-react';

interface MessageContextMenuProps {
    x: number;
    y: number;
    isFavorite: boolean;
    onToggleFavorite: () => void;
    onClose: () => void;
}

export const MessageContextMenu: React.FC<MessageContextMenuProps> = ({
    x,
    y,
    isFavorite,
    onToggleFavorite,
    onClose,
}) => {
    const menuRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        // Close on escape key
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    // Adjust position to stay within viewport
    const adjustedPosition = useCallback(() => {
        const menuWidth = 200;
        const menuHeight = 48;
        const padding = 8;

        let adjustedX = x;
        let adjustedY = y;

        // Keep menu within viewport horizontally
        if (x + menuWidth > window.innerWidth - padding) {
            adjustedX = window.innerWidth - menuWidth - padding;
        }

        // Keep menu within viewport vertically
        if (y + menuHeight > window.innerHeight - padding) {
            adjustedY = y - menuHeight;
        }

        return { left: adjustedX, top: adjustedY };
    }, [x, y]);

    const position = adjustedPosition();

    const handleClick = () => {
        onToggleFavorite();
        onClose();
    };

    return (
        <div
            ref={menuRef}
            className="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[180px]"
            style={position}
        >
            <button
                onClick={handleClick}
                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2 transition-colors"
            >
                <Star
                    className={`w-4 h-4 ${isFavorite ? 'text-blue-500 fill-blue-500' : 'text-gray-400'}`}
                />
                {isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            </button>
        </div>
    );
};
