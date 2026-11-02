import React, { useEffect, useRef } from 'react';
import { Image } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Z_CLASS } from '../../../constants/zIndex';
import { Portal } from '../../../core/common/Portal';

interface MemberContextMenuProps {
    x: number;
    y: number;
    onViewImages: () => void;
    onClose: () => void;
}

/** Right-click menu for a member in the member list. */
export const MemberContextMenu: React.FC<MemberContextMenuProps> = ({ x, y, onViewImages, onClose }) => {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [onClose]);

    return (
        <Portal>
            <div
                ref={ref}
                role="menu"
                className={`fixed bg-white rounded-lg shadow-lg border border-gray-100 py-1 min-w-[140px] ${Z_CLASS.MODAL}`}
                style={{ left: x, top: y }}
            >
                <button
                    role="menuitem"
                    onClick={() => { onViewImages(); onClose(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                    <Image className="w-4 h-4" />
                    {t('profileImages.viewImages')}
                </button>
            </div>
        </Portal>
    );
};
