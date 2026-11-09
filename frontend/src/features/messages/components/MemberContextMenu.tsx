import React from 'react';
import { Image } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Menu, MenuItem } from '../../../design/primitives';

interface MemberContextMenuProps {
    x: number;
    y: number;
    onViewImages: () => void;
    onClose: () => void;
}

// Conservative menu size used until the real size is measured.
const ESTIMATED_SIZE = { width: 200, height: 48 };

/** Right-click menu for a member in the member list. */
export const MemberContextMenu: React.FC<MemberContextMenuProps> = ({ x, y, onViewImages, onClose }) => {
    const { t } = useTranslation();
    return (
        <Menu aria-label={t('profileImages.viewImages')} onClose={onClose} point={{ x, y }} estimatedSize={ESTIMATED_SIZE}>
            <MenuItem icon={<Image className="h-4 w-4" />} onClick={() => { onViewImages(); onClose(); }}>
                {t('profileImages.viewImages')}
            </MenuItem>
        </Menu>
    );
};
