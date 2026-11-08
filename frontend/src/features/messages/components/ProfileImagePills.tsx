import React from 'react';
import { List, MessageCircle, Phone } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { KIND_I18N_KEY, PROFILE_IMAGE_KINDS, type ProfileImageKind, type ProfileImagesByKind } from '../profileImages';

const ICONS: Record<ProfileImageKind, React.ComponentType<{ className?: string }>> = {
    group_thumbnail: List,
    thumbnail: MessageCircle,
    phone_image: Phone,
};

interface ProfileImagePillsProps {
    images: ProfileImagesByKind;
    onOpen: (kind: ProfileImageKind) => void;
}

/** Three small pills under the member name: list icon, chat icon, call screen. */
export const ProfileImagePills: React.FC<ProfileImagePillsProps> = ({ images, onOpen }) => {
    const { t } = useTranslation();
    const kinds = PROFILE_IMAGE_KINDS.filter(k => (images[k]?.length ?? 0) > 0);
    if (kinds.length === 0) return null;
    return (
        <div className="flex justify-center gap-2">
            {kinds.map((k) => {
                const Icon = ICONS[k];
                const count = images[k]!.length;
                return (
                    <button
                        key={k}
                        type="button"
                        onClick={() => onOpen(k)}
                        title={t(`profileImages.${KIND_I18N_KEY[k]}Hint`)}
                        aria-label={t(`profileImages.${KIND_I18N_KEY[k]}`)}
                        className="inline-flex items-center gap-1 rounded-pill bg-pill px-3 py-1 text-caption text-secondary shadow-pill transition-colors duration-fast ease-standard hover:bg-sunken hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <Icon className="h-3 w-3" />
                        {t(`profileImages.${KIND_I18N_KEY[k]}`)}
                        {count > 1 && (
                            <span className="rounded-pill bg-sunken px-1 tabular-nums text-secondary ring-1 ring-strong" title={t('profileImages.versions', { count })}>{count}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
};
