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
        <div className="flex justify-center gap-1.5 mb-4">
            {kinds.map(k => {
                const Icon = ICONS[k];
                const count = images[k]!.length;
                return (
                    <button
                        key={k}
                        onClick={() => onOpen(k)}
                        title={t(`profileImages.${KIND_I18N_KEY[k]}Hint`)}
                        aria-label={t(`profileImages.${KIND_I18N_KEY[k]}`)}
                        className="inline-flex items-center gap-1 text-[11px] text-gray-600 bg-gray-100 border border-gray-200 rounded-full px-2.5 py-1 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 transition-colors"
                    >
                        <Icon className="w-3 h-3" />
                        {t(`profileImages.${KIND_I18N_KEY[k]}`)}
                        {count > 1 && (
                            <span className="text-[9px] text-white bg-sky-400 rounded-full px-1 leading-4" title={t('profileImages.versions', { count })}>
                                {count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
};
