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
 * (aged with `sepia`; the shared media tile, allowed the album covers' 640 px thumbnail) and one caption line with her nearby words (`caption`, else her own
 * `text`) in the display serif through `MemoryText`; without words, the month label as the
 * band's heading (`h2`; the band shows no heading of its own then).
 * With `onResetCover` the polaroid sits in a menu button (`role="button"`, `aria-haspopup="menu"`,
 * named by the month): a click, Enter / Space, a right-click, the context-menu key or Shift+F10
 * opens the menu with 「表紙を自動にもどす」. The `figure` itself never carries ARIA it cannot have.
 */
export const PolaroidCover: React.FC<PolaroidCoverProps> = ({ cover, label, sepia, onResetCover }) => {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);
    const resettable = onResetCover !== undefined;
    const menu = useContextMenu(resettable);
    const words = cover.caption ?? cover.text;
    const figure = (
        <figure
            data-testid="album-polaroid"
            className="w-40 shrink-0 -rotate-1 border border-memories-paper bg-memories-paper p-2 pb-3 shadow-memories-polaroid motion-reduce:rotate-0"
        >
            <div className="aspect-square w-full overflow-hidden bg-sunken">
                <MemoryThumb message={cover} px={COVER_PX} large className={cn('h-full w-full', sepia)} />
            </div>
            <figcaption className="mt-2 font-display text-small text-primary">
                {words
                    ? <MemoryText as="span" text={words} className="block truncate whitespace-nowrap" />
                    : <h2 className="block truncate">{label}</h2>}
            </figcaption>
        </figure>
    );
    if (!resettable) return figure;

    // A div, not a <button>: the polaroid can hold the band's h2, which a button may not contain.
    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            menu.openAt(e.currentTarget);
            return;
        }
        menu.onKeyDown(e);
    };
    return (
        <>
            <div
                ref={ref}
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={menu.point !== null}
                onClick={(e) => (menu.point ? menu.close() : menu.openAt(e.currentTarget))}
                onContextMenu={menu.onContextMenu}
                onKeyDown={onKeyDown}
                className="shrink-0 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                {figure}
            </div>
            {menu.point && onResetCover && (
                <Menu aria-label={label} onClose={menu.close} point={menu.point} returnFocusRef={ref} ignoreRefs={[ref]}>
                    <MenuItem icon={<RotateCcw />} onClick={() => { menu.close(); onResetCover(); }}>
                        {t('memories.album.resetCover')}
                    </MenuItem>
                </Menu>
            )}
        </>
    );
};
