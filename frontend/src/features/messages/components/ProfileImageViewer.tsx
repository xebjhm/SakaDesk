import React, { useMemo, useState } from 'react';
import { MediaViewerModal } from '../../../core/media/PhotoDetailModal';
import type { MediaViewerItem } from '../../../core/media/PhotoDetailModal';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import {
    KIND_I18N_KEY,
    PROFILE_IMAGE_KINDS,
    periodLabel,
    type ProfileImageKind,
    type ProfileImagesByKind,
} from '../profileImages';

interface ProfileImageViewerProps {
    images: ProfileImagesByKind;
    initialKind: ProfileImageKind;
    onClose: () => void;
}

/**
 * Member image history: one tab per kind (list icon / chat icon / call screen),
 * Left/Right through that kind's versions newest first. Copy/save follow the
 * existing 金手指 rule inside MediaViewerModal.
 */
export const ProfileImageViewer: React.FC<ProfileImageViewerProps> = ({ images, initialKind, onClose }) => {
    const { t } = useTranslation();
    const available = PROFILE_IMAGE_KINDS.filter(k => (images[k]?.length ?? 0) > 0);
    const [kind, setKind] = useState<ProfileImageKind>(available.includes(initialKind) ? initialKind : available[0]);
    const [index, setIndex] = useState(0);

    const items: MediaViewerItem[] = useMemo(() => {
        const entries = images[kind] ?? [];
        return entries.map((e, i) => ({
            src: e.url,
            type: 'picture' as const,
            timestamp: e.first_seen ?? '',
            sourceLabel: periodLabel(entries, i, t('profileImages.current')) || undefined,
        }));
    }, [images, kind, t]);

    if (available.length === 0) return null;

    const tabs = (
        <div role="tablist" className="flex gap-1.5">
            {available.map(k => (
                <button
                    key={k}
                    role="tab"
                    aria-selected={k === kind}
                    title={t(`profileImages.${KIND_I18N_KEY[k]}Hint`)}
                    onClick={() => { setKind(k); setIndex(0); }}
                    className={cn(
                        'px-3 py-1 rounded-full text-xs transition-colors',
                        k === kind ? 'bg-white text-gray-900' : 'bg-white/15 text-white/80 hover:bg-white/25',
                    )}
                >
                    {t(`profileImages.${KIND_I18N_KEY[k]}`)}
                    {k === kind && (images[k]?.length ?? 0) > 1 && ` ${index + 1}/${images[k]!.length}`}
                </button>
            ))}
        </div>
    );

    return (
        <MediaViewerModal
            mediaItems={items}
            currentIndex={Math.min(index, items.length - 1)}
            onClose={onClose}
            onNavigate={setIndex}
            headerSlot={tabs}
        />
    );
};
