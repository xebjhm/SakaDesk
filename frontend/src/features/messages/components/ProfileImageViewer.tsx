import React, { useMemo, useRef, useState } from 'react';
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
 * the kind's versions are listed newest first, but Left is always the older version and Right the newer (counter: oldest = 1). Copy/save follow the
 * existing 金手指 rule inside MediaViewerModal.
 */
export const ProfileImageViewer: React.FC<ProfileImageViewerProps> = ({ images, initialKind, onClose }) => {
    const { t } = useTranslation();
    const available = PROFILE_IMAGE_KINDS.filter(k => (images[k]?.length ?? 0) > 0);
    const [kind, setKind] = useState<ProfileImageKind>(available.includes(initialKind) ? initialKind : available[0]);
    const [index, setIndex] = useState(0);
    const tabRefs = useRef<Partial<Record<ProfileImageKind, HTMLButtonElement | null>>>({});

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

    // Arrows, Home and End move between the kinds and select them (UI health A-D5; the tabs pattern).
    const onTabsKeyDown = (e: React.KeyboardEvent) => {
        const at = available.indexOf(kind);
        const next = e.key === 'ArrowRight' ? (at + 1) % available.length
            : e.key === 'ArrowLeft' ? (at - 1 + available.length) % available.length
            : e.key === 'Home' ? 0
            : e.key === 'End' ? available.length - 1
            : -1;
        if (next === -1) return;
        e.preventDefault();
        e.stopPropagation(); // the viewer's left / right step photos only outside the tabs
        setKind(available[next]);
        setIndex(0);
        tabRefs.current[available[next]]?.focus();
    };

    const tabs = (
        <div role="tablist" aria-label={t('profileImages.kinds')} className="flex gap-1" onKeyDown={onTabsKeyDown}>
            {available.map(k => (
                <button
                    key={k}
                    type="button"
                    ref={(el) => { tabRefs.current[k] = el; }}
                    role="tab"
                    aria-selected={k === kind}
                    tabIndex={k === kind ? 0 : -1}
                    title={t(`profileImages.${KIND_I18N_KEY[k]}Hint`)}
                    onClick={() => { setKind(k); setIndex(0); }}
                    className={cn(
                        'rounded-pill px-3 py-1 text-caption transition-colors duration-fast ease-standard',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        k === kind ? 'bg-pill font-semibold text-primary' : 'bg-viewer-control text-viewer-muted hover:bg-viewer-control-hover',
                    )}
                >
                    {t(`profileImages.${KIND_I18N_KEY[k]}`)}
                    {k === kind && (images[k]?.length ?? 0) > 1 && ` ${images[k]!.length - index}/${images[k]!.length}`}
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
            order="newest_first"
        />
    );
};
