import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

// Conservative size used until the real one is measured (and where layout is unavailable).
const ESTIMATED_SIZE = { width: 200, height: 48 };
const VIEWPORT_PADDING = 8;

/** Right-click menu for a member in the member list. */
export const MemberContextMenu: React.FC<MemberContextMenuProps> = ({ x, y, onViewImages, onClose }) => {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState(ESTIMATED_SIZE);

    // Measure the rendered menu so clamping uses its real size.
    useLayoutEffect(() => {
        const rect = ref.current?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
            setSize(prev => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }));
        }
    }, []);

    // Keep the whole menu inside the viewport.
    const left = Math.max(VIEWPORT_PADDING, Math.min(x, window.innerWidth - size.width - VIEWPORT_PADDING));
    const top = Math.max(VIEWPORT_PADDING, Math.min(y, window.innerHeight - size.height - VIEWPORT_PADDING));

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
                style={{ left, top }}
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
