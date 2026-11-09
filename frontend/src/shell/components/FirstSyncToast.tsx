import React, { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { CelebrationToast } from '../../design/primitives';
import { BrandScope } from '../../design/brandScope';
import { Z_INDEX } from '../../constants/zIndex';
import { useArchiveStats } from '../../core/modals/archiveStats';

/** How long the first-sync toast stays (spec §9: a celebration never needs dismissing). */
export const FIRST_SYNC_TOAST_MS = 6000;

/**
 * Tier-B celebration of the first complete sync (spec §9, decision D11): a brand toast at the
 * bottom right on the toast layer, with the saved message count when it is known. It never
 * takes the pointer, so it cannot block input.
 */
export const FirstSyncToast: React.FC<{ onDone: () => void }> = ({ onDone }) => {
    const { t, i18n } = useTranslation();
    const archive = useArchiveStats(true);
    useEffect(() => {
        const timer = setTimeout(onDone, FIRST_SYNC_TOAST_MS);
        return () => clearTimeout(timer);
    }, [onDone]);
    const messages = archive.status === 'ready' ? archive.stats.messages : 0;
    return (
        <div data-testid="first-sync-toast" style={{ zIndex: Z_INDEX.TOAST }} className="pointer-events-none fixed bottom-4 right-4">
            <BrandScope>
                <CelebrationToast
                    icon={<Sparkles aria-hidden="true" className="h-4 w-4" />}
                    title={t('celebration.firstSyncTitle')}
                    description={messages > 0 ? t('celebration.firstSyncBody', { count: messages, value: messages.toLocaleString(i18n.language) }) : undefined}
                />
            </BrandScope>
        </div>
    );
};
