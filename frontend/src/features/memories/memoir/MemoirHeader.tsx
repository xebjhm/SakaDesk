import React from 'react';
import { useTranslation } from '../../../i18n';
import { Avatar, Skeleton } from '../../../design/primitives';
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
    /** The 彼女の24時間 chip: opens the `day24` tab (spec 14.1). Without it the chip is not drawn. */
    onDay24?: () => void;
}

const CHIP_BUTTON = cn(
    CHIP,
    'transition-colors duration-fast ease-standard hover:text-primary',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
);

/**
 * The memoir header (spec 5, 5.1): her current avatar, her serif name (`lang="ja"`) and up to
 * three chips, each its own small moment with one number: 「メンバーシップ N 日」, 「名前を呼んでくれた
 * N 回」 (a button to the names tab) and the voice time ({@link voiceChip}). A chip whose value is
 * null (0 or unknown) is not drawn. After them, when the host routes to it, the 「彼女の24時間」 chip
 * button (no number) opens her 24 hours.
 */
export const MemoirHeader: React.FC<MemoirHeaderProps> = ({ header, onNames, onDay24 }) => {
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
                            className={CHIP_BUTTON}
                        >
                            {t('memories.memoir.chipNames', { count: names })}
                        </button>
                    )}
                    {voiceCopy && (
                        <span data-testid="memoir-chip" className={CHIP}>{t(voiceCopy.key, voiceCopy.params)}</span>
                    )}
                    {onDay24 && (
                        <button type="button" data-testid="memoir-chip-day24" onClick={onDay24} className={CHIP_BUTTON}>
                            {t('memories.day24.tab')}
                        </button>
                    )}
                </div>
            </div>
        </header>
    );
};

/**
 * The header's place while it loads (same height), so the tabs and binder do not jump: paper
 * `Skeleton`s (her avatar circle and two lines) under `role="status"` with an `sr-only`
 * `loading.label` (visible under reduced motion, where the skeletons hold still).
 */
export const MemoirHeaderPlaceholder: React.FC = () => {
    const { t } = useTranslation();
    const label = t('loading.label');
    return (
        <div data-testid="memoir-header-loading" role="status" aria-busy="true" aria-label={label} className="flex shrink-0 items-center gap-4 px-4 py-3">
            <Skeleton shape="circle" tone="paper" className="h-14 w-14 shrink-0" />
            <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton shape="line" tone="paper" className="h-6 w-40" />
                <Skeleton shape="line" tone="paper" className="h-6 w-64" />
            </span>
            {/* Under reduced motion the skeletons hold still: the label then shows. */}
            <span className="sr-only shrink-0 text-small text-secondary motion-reduce:not-sr-only">{label}</span>
        </div>
    );
};
