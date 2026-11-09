import React from 'react';
import { Star } from 'lucide-react';
import { cn } from '../../../utils/classnames';
import { useTranslation } from '../../../i18n';
import { Menu, MenuItem } from '../../../design/primitives';

interface MessageContextMenuProps {
    x: number;
    y: number;
    isFavorite: boolean;
    onToggleFavorite: () => void;
    onClose: () => void;
}

export const MessageContextMenu: React.FC<MessageContextMenuProps> = ({ x, y, isFavorite, onToggleFavorite, onClose }) => {
    const { t } = useTranslation();
    return (
        <Menu aria-label={t('messageList.messageActions')} onClose={onClose} point={{ x, y }} estimatedSize={{ width: 200, height: 48 }}>
            <MenuItem
                icon={<Star className={cn('h-4 w-4', isFavorite ? 'fill-current text-semantic-star drop-shadow-sm' : 'text-muted')} />}
                onClick={() => { onToggleFavorite(); onClose(); }}
            >
                {isFavorite ? t('favorites.removeFromFavorites') : t('favorites.addToFavorites')}
            </MenuItem>
        </Menu>
    );
};
