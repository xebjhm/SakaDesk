import React, { useState, useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import type { BaseModalProps } from '../../../types/modal';
import { groupTokens } from '../../../design/tokens';
import { serviceGroupId } from '../../../config/serviceGroup';
import { Modal, IconButton, Button } from '../../../design/primitives';
import { logDialogLoad } from '../../../design/dialog/dialogLog';
import { useTranslation, Trans } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { fetchProfileImages, type ProfileImageKind, type ProfileImagesByKind } from '../profileImages';
import { ProfileImagePills } from './ProfileImagePills';
import { ProfileImageViewer } from './ProfileImageViewer';
import type { StreakState } from '../hooks/useMemberStreak';

interface MemberProfilePopupProps extends BaseModalProps {
    memberName: string;
    memberAvatar?: string;
    /** The room's streak from MessagesFeature's useMemberStreak (session cache, once per room per day). */
    streak?: StreakState;
    onRetryStreak?: () => void;
    activeService?: string; // Service ID for API calls
    /** Member directory; pills/viewer are shown only when set (single-member chats). */
    memberPath?: string;
}

/**
 * Member profile popup showing avatar, name, and subscription streak.
 * Mimics the official app design with large centered avatar.
 */
export const MemberProfilePopup: React.FC<MemberProfilePopupProps> = ({
    isOpen,
    onClose,
    memberName,
    memberAvatar,
    streak = { status: 'idle' },
    onRetryStreak,
    activeService,
    memberPath,
}) => {
    const { t } = useTranslation();
    const [images, setImages] = useState<ProfileImagesByKind>({});
    const [viewerKind, setViewerKind] = useState<ProfileImageKind | null>(null);

    useEffect(() => {
        if (!isOpen || !memberPath) { setImages({}); return; }
        const controller = new AbortController();
        setImages({});
        fetchProfileImages(memberPath, controller.signal)
            .then(k => {
                if (controller.signal.aborted) { logDialogLoad('profile_images', 'cancelled'); return; }
                setImages(k);
                logDialogLoad('profile_images', 'ok', Object.values(k).reduce((n, v) => n + (v?.length ?? 0), 0));
            })
            .catch(() => {
                if (controller.signal.aborted) { logDialogLoad('profile_images', 'cancelled'); return; }
                setImages({});
                logDialogLoad('profile_images', 'error');
            });
        return () => controller.abort();
    }, [isOpen, memberPath]);

    // The chat header's style: 'gradient' (filled title gradient) or 'light' (white + thin title bar).
    const isLightHeader = groupTokens[serviceGroupId(activeService ?? null)].official.headerStyle === 'light';

    // Reset when closed
    useEffect(() => {
        if (!isOpen) {
            setViewerKind(null);
        }
    }, [isOpen]);

    return (
        <>
            <Modal
                isOpen={isOpen}
                onClose={onClose}
                layout="bare"
                labelledBy="profile-title"
                logId="member_profile"
                className="relative max-w-sm"
            >
                <IconButton
                    variant={isLightHeader ? 'ghost' : 'overlay'}
                    size="sm"
                    className="absolute right-4 top-4 z-10"
                    aria-label={t('common.close')}
                    icon={<X />}
                    onClick={onClose}
                />
                {/* Official title banner, as the chat header: gradient, or white + the thin title bar. */}
                <div className={cn('h-32 shrink-0', isLightHeader ? 'bg-sheet' : 'bg-group-title')} />
                {isLightHeader && <div className="-mt-1 h-1 shrink-0 bg-group-title-bar" />}

                <div className="-mt-24 flex justify-center">
                    <button
                        type="button"
                        disabled={!images.thumbnail?.length}
                        onClick={() => setViewerKind('thumbnail')}
                        aria-label={memberName}
                        className={cn(
                            'h-48 w-48 overflow-hidden rounded-pill bg-sunken shadow-sheet ring-4 ring-surface',
                            'focus-visible:outline-none focus-visible:ring-group',
                            images.thumbnail?.length ? 'cursor-zoom-in' : 'cursor-default',
                        )}
                    >
                        {memberAvatar ? (
                            <img src={memberAvatar} alt={memberName} className="h-full w-full object-cover" />
                        ) : (
                            <span className="flex h-full w-full items-center justify-center text-heading font-semibold text-muted">{memberName.substring(0, 2)}</span>
                        )}
                    </button>
                </div>

                <div className="flex flex-col items-center gap-4 px-6 pb-8 pt-4 text-center">
                    <h2 id="profile-title" className="text-heading font-semibold text-primary">{memberName}</h2>
                    <ProfileImagePills images={images} onOpen={setViewerKind} />
                    {streak.status === 'loading' ? (
                        <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-muted motion-reduce:animate-none" />
                    ) : streak.status === 'error' ? (
                        <div role="alert" className="flex flex-col items-center gap-2">
                            <p className="text-small text-status-danger">{streak.message}</p>
                            <Button variant="secondary" size="sm" onClick={onRetryStreak}>{t('memberProfile.retry')}</Button>
                        </div>
                    ) : streak.status === 'ready' && streak.days > 0 ? (
                        <p className="text-title text-secondary">
                            <Trans
                                i18nKey="memberProfile.subscribedDays"
                                values={{ days: streak.days }}
                                components={{ num: <span className="text-heading font-semibold text-primary" /> }}
                            />
                        </p>
                    ) : streak.status === 'ready' ? (
                        <p className="text-title text-muted">{t('memberProfile.startSubscription')}</p>
                    ) : null}
                </div>
            </Modal>
            {isOpen && viewerKind && (
                <ProfileImageViewer images={images} initialKind={viewerKind} onClose={() => setViewerKind(null)} />
            )}
        </>
    );
};
