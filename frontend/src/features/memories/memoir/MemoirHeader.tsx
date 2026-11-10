import React from 'react';
import { useTranslation } from '../../../i18n';
import { Avatar } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import { resizedAvatarUrl } from '../../messages/mediaUrl';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';
import type { MemoirHeaderPayload } from '../types';
import { voiceChip } from './binderModel';

const AVATAR_PX = 56;

const CHIP = 'inline-flex items-center rounded-pill bg-pill px-3 py-1 text-small text-secondary shadow-pill';

interface MemoirHeaderProps {
    header: MemoirHeaderPayload;
    /** The names chip: opens the 被叫名字 tab (spec 5.2). */
    onNames: () => void;
}

/**
 * The memoir header (spec 5, 5.1): her current avatar, her serif name (`lang="ja"`) and up to
 * three chips, each its own small moment with one number: 「メンバーシップ N 日」, 「名前を呼んでくれた
 * N 回」 (a button to the names tab) and the voice time ({@link voiceChip}). A chip whose value is
 * null (0 or unknown) is not drawn.
 */
export const MemoirHeader: React.FC<MemoirHeaderProps> = ({ header, onNames }) => {
    const { t } = useTranslation();
    const width = useAvatarWidth(AVATAR_PX);
    const { subscription_days: days, nickname_count: names, voice_seconds: voice } = header.chips;
    const voiceCopy = voiceChip(voice);
    return (
        <header className="flex shrink-0 items-center gap-4 px-4 py-3">
            <Avatar src={resizedAvatarUrl(header.avatar_url, width)} name={header.name} size="lg" decorative />
            <div className="min-w-0 flex-1">
                <h2 lang="ja" className="truncate font-display text-heading text-primary">{header.name}</h2>
                <div className="mt-1 flex flex-wrap gap-2">
                    {days !== null && (
                        <span data-testid="memoir-chip" className={CHIP}>{t('memories.memoir.chipDays', { days })}</span>
                    )}
                    {names !== null && (
                        <button
                            type="button"
                            data-testid="memoir-chip"
                            onClick={onNames}
                            className={cn(
                                CHIP,
                                'transition-colors duration-fast ease-standard hover:text-primary',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                            )}
                        >
                            {t('memories.memoir.chipNames', { count: names })}
                        </button>
                    )}
                    {voiceCopy && (
                        <span data-testid="memoir-chip" className={CHIP}>{t(voiceCopy.key, voiceCopy.params)}</span>
                    )}
                </div>
            </div>
        </header>
    );
};
