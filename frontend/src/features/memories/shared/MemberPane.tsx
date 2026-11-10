import React from 'react';
import { Heart, Users } from 'lucide-react';
import { Avatar } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
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
    className?: string;
}

const AVATAR_PX = 32;

const ROW = cn(
    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-body text-primary',
    'transition-colors duration-fast ease-standard hover:bg-sunken',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
);
// Group colour only on the selected row (identity / current state).
const SELECTED = 'bg-accent-subtle font-semibold text-accent-strong hover:bg-accent-subtle';

/**
 * The Memories left list (album, favorites, memoir): an optional all row, then one row per
 * person with her avatar, name (`lang="ja"`), an oshi heart in the semantic oshi tone (never
 * the group accent) and a trailing detail. Scrolls inside itself.
 */
export const MemberPane: React.FC<MemberPaneProps> = ({ items, selectedKey, onSelect, allLabel, allTrailing, className }) => {
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
                    <span className="min-w-0 flex-1 truncate">{allLabel}</span>
                    {allTrailing !== undefined && <span className="shrink-0 text-small tabular-nums text-muted">{allTrailing}</span>}
                </button>
            )}
            {items.map((item) => {
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
                        <span lang="ja" className="min-w-0 flex-1 truncate">{item.name}</span>
                        {item.oshi && (
                            <Heart
                                data-testid="member-pane-oshi"
                                aria-hidden="true"
                                className="h-3.5 w-3.5 shrink-0 fill-semantic-oshi text-semantic-oshi-solid"
                            />
                        )}
                        {item.trailing !== undefined && <span className="shrink-0 text-small tabular-nums text-muted">{item.trailing}</span>}
                    </button>
                );
            })}
        </nav>
    );
};
