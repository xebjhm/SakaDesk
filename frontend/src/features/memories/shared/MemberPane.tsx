import React from 'react';
import { Heart, Users } from 'lucide-react';
import { useDelayedLoading } from '../../../design/loading';
import { Avatar, Skeleton, StatusBlock } from '../../../design/primitives';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import type { MemberPaneStatus } from './memberPaneStatus';
import { resizedAvatarUrl } from '../../messages/mediaUrl';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';

export interface MemberPaneItem {
    key: string;
    memberPath?: string;
    name: string;
    avatarUrl?: string | null;
    oshi?: boolean;
    /** Right-hand detail (a count, progress). */
    trailing?: React.ReactNode;
}

interface MemberPaneProps {
    items: MemberPaneItem[];
    /** The selected item's key; null = the all row. */
    selectedKey: string | null;
    /** The item's key, or null for the all row. */
    onSelect: (key: string | null) => void;
    /** Shows a first row for everyone (「全員」 / 「全部收藏」) with this label. */
    allLabel?: string;
    /** Right-hand detail of the all row. */
    allTrailing?: React.ReactNode;
    /**
     * The member list's load state (default `ready`): `loading` draws skeleton rows after the
     * reveal delay, `error` / `timeout` an inline line with Retry (`onRetry`) below the all row.
     */
    status?: MemberPaneStatus;
    /** Retry of the member list (shown with `status` `error` / `timeout`). */
    onRetry?: () => void;
    className?: string;
}

const AVATAR_PX = 32;

/** The pane's narrowest width, in rem: what it gets at the 960 x 640 minimum window. */
export const MEMBER_PANE_MIN_REM = 12.5;

/**
 * The pane's width beside a Memories page: about a quarter of the row, between 12.5rem and 15rem,
 * so the page's own content keeps room at the smallest window instead of a fixed 15rem. At the
 * minimum the name line still holds a five-character name plus the oshi heart (N2).
 */
export const MEMBER_PANE_WIDTH = 'w-[clamp(12.5rem,24%,15rem)]';

/** A trailing detail worth drawing: never a bare 0 (spec 1.1: no call-out of an absence). */
const shown = (trailing: React.ReactNode) => trailing !== undefined && trailing !== null && trailing !== 0;
/** A text or number trailing detail as a tooltip (the full value when it truncates). */
const plain = (trailing: React.ReactNode) =>
    typeof trailing === 'string' || typeof trailing === 'number' ? String(trailing) : undefined;

const ROW = cn(
    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-body text-primary',
    'transition-colors duration-fast ease-standard hover:bg-sunken',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
);
// Name first (N2): the name (with the oshi heart) has the whole first line to itself and the
// trailing detail sits on its own line below, so neither competes for the row's width. A narrow
// pane truncates only a long name, never down to 「全…」 beside a 「3·」.
const TEXT = 'flex min-w-0 flex-1 flex-col';
const NAME_LINE = 'flex min-w-0 items-center gap-1';
const NAME = 'min-w-0 truncate';
const TRAILING = 'min-w-0 truncate text-small tabular-nums text-muted';
// Group colour only on the selected row (identity / current state).
const SELECTED = 'bg-accent-subtle font-semibold text-accent-strong hover:bg-accent-subtle';

/** Skeleton rows drawn while the member list loads. */
const SKELETON_ROWS = 6;

/** Six avatar + name skeleton rows under a labelled `role="status"`, from the reveal delay on. */
const LoadingRows: React.FC = () => {
    const { t } = useTranslation();
    const shownNow = useDelayedLoading(true);
    const label = t('loading.label');
    if (!shownNow) return <div role="status" aria-busy="true" aria-label={label} />;
    return (
        <div role="status" aria-label={label} className="flex flex-col gap-1">
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <div key={i} data-testid="member-pane-skeleton-row" className="flex items-center gap-3 px-3 py-2">
                    <Skeleton shape="circle" className="h-8 w-8 shrink-0" />
                    <Skeleton shape="line" className="w-24" />
                </div>
            ))}
            {/* Under reduced motion the skeletons hold still: the label says what is happening. */}
            <span className="sr-only px-3 text-small text-secondary motion-reduce:not-sr-only">{label}</span>
        </div>
    );
};

/**
 * The Memories left list (album, favorites, memoir, radio): an optional all row, then one
 * row per person with her avatar, name (`lang="ja"`), an oshi heart in the semantic oshi tone
 * (never the group accent) and a trailing detail (never a 0) on its own line below the name, so a
 * long detail (「1 小時 1 分」) never takes the name's width. Scrolls inside itself.
 * While the list loads (`status` `loading`) the all row stays and six skeleton rows follow from
 * the reveal delay (`role="status"`, `loading.label`); a failed load shows an inline
 * `StatusBlock` below the all row: `memories.common.membersError` (error) or the Memories
 * timeout copy (timeout), each with Retry (`onRetry`; without one the line shows no button).
 */
export const MemberPane: React.FC<MemberPaneProps> = ({ items, selectedKey, onSelect, allLabel, allTrailing, status = 'ready', onRetry, className }) => {
    const { t } = useTranslation();
    const width = useAvatarWidth(AVATAR_PX);
    return (
        <nav className={cn('flex min-h-0 flex-col gap-1 overflow-y-auto p-2', className)}>
            {allLabel !== undefined && (
                <button
                    type="button"
                    onClick={() => onSelect(null)}
                    aria-current={selectedKey === null ? 'true' : undefined}
                    className={cn(ROW, selectedKey === null && SELECTED)}
                >
                    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-sunken text-secondary">
                        <Users className="h-4 w-4" />
                    </span>
                    <span className={TEXT}>
                        <span data-testid="member-pane-all-label" className={NAME}>{allLabel}</span>
                        {shown(allTrailing) && (
                            <span data-testid="member-pane-all-trailing" title={plain(allTrailing)} className={TRAILING}>{allTrailing}</span>
                        )}
                    </span>
                </button>
            )}
            {status === 'loading' && <LoadingRows />}
            {(status === 'error' || status === 'timeout') && (
                status === 'timeout' && onRetry ? (
                    <StatusBlock
                        kind="timeout"
                        variant="inline"
                        surface="memories_members"
                        title={t('memories.common.timeout')}
                        hint={t('memories.common.timeoutHint')}
                        onRetry={onRetry}
                        retryLabel={t('memories.common.retry')}
                        className="px-3 py-2"
                    />
                ) : (
                    <StatusBlock
                        kind="error"
                        variant="inline"
                        surface="memories_members"
                        title={t(status === 'timeout' ? 'memories.common.timeout' : 'memories.common.membersError')}
                        onRetry={onRetry}
                        retryLabel={t('memories.common.retry')}
                        className="px-3 py-2"
                    />
                )
            )}
            {status === 'ready' && items.map((item) => {
                const selected = item.key === selectedKey;
                return (
                    <button
                        key={item.key}
                        type="button"
                        onClick={() => onSelect(item.key)}
                        aria-current={selected ? 'true' : undefined}
                        className={cn(ROW, selected && SELECTED)}
                    >
                        <Avatar src={resizedAvatarUrl(item.avatarUrl, width)} name={item.name} size="sm" decorative />
                        <span className={TEXT}>
                            <span data-testid="member-pane-name-line" className={NAME_LINE}>
                                <span lang="ja" title={item.name} data-testid="member-pane-name" className={NAME}>{item.name}</span>
                                {item.oshi && (
                                    <Heart
                                        data-testid="member-pane-oshi"
                                        aria-hidden="true"
                                        className="h-3.5 w-3.5 shrink-0 fill-semantic-oshi text-semantic-oshi-solid"
                                    />
                                )}
                            </span>
                            {shown(item.trailing) && (
                                <span data-testid="member-pane-trailing" title={plain(item.trailing)} className={TRAILING}>{item.trailing}</span>
                            )}
                        </span>
                    </button>
                );
            })}
        </nav>
    );
};
