import React, { useRef } from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Menu, MenuItem } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import type { MemoryMessage } from '../types';
import { useContextMenu } from './useContextMenu';

/** The cover photo's drawn size (`w-40` minus the frame). */
const COVER_PX = 144;

interface PolaroidCoverProps {
    cover: MemoryMessage;
    /** The month label, shown when there are no words to caption the cover with. */
    label: string;
    /** `sepiaClass` of the month's year, applied to the photo only. */
    sepia: string;
    /** The cover is the fan's own choice (rule `override`): its context menu offers 「表紙を自動にもどす」. */
    onResetCover?: () => void;
}

/**
 * A month's polaroid cover (spec 8): warm paper frame with the polaroid shadow, the cover photo
 * (aged with `sepia`) and one caption line with her nearby words (`caption`, else her own
 * `text`) in the display serif through `MemoryText`; without words, the month label as the
 * band's heading (`h2`; the band shows no heading of its own then).
 * With `onResetCover` the polaroid takes focus and its context menu (right-click, the
 * context-menu key or Shift+F10) offers 「表紙を自動にもどす」.
 */
export const PolaroidCover: React.FC<PolaroidCoverProps> = ({ cover, label, sepia, onResetCover }) => {
    const { t } = useTranslation();
    const ref = useRef<HTMLElement>(null);
    const resettable = onResetCover !== undefined;
    const menu = useContextMenu(resettable);
    const words = cover.caption ?? cover.text;
    return (
        <>
            <figure
                ref={ref}
                data-testid="album-polaroid"
                tabIndex={resettable ? 0 : undefined}
                aria-label={resettable ? label : undefined}
                aria-haspopup={resettable ? 'menu' : undefined}
                onContextMenu={menu.onContextMenu}
                onKeyDown={menu.onKeyDown}
                className={cn(
                    'w-40 shrink-0 -rotate-1 border border-memories-paper bg-memories-paper p-2 pb-3 shadow-memories-polaroid motion-reduce:rotate-0',
                    resettable && 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                )}
            >
                <div className="aspect-square w-full overflow-hidden bg-sunken">
                    <MemoryThumb message={cover} px={COVER_PX} className={cn('h-full w-full', sepia)} />
                </div>
                <figcaption className="mt-2 font-display text-small text-primary">
                    {words
                        ? <MemoryText as="span" text={words} className="block truncate whitespace-nowrap" />
                        : <h2 className="block truncate">{label}</h2>}
                </figcaption>
            </figure>
            {menu.point && onResetCover && (
                <Menu aria-label={label} onClose={menu.close} point={menu.point} returnFocusRef={ref}>
                    <MenuItem icon={<RotateCcw />} onClick={() => { menu.close(); onResetCover(); }}>
                        {t('memories.album.resetCover')}
                    </MenuItem>
                </Menu>
            )}
        </>
    );
};
