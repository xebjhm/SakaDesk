import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/classnames';
import { clientLog } from '../../utils/clientLog';
import { Z_INDEX } from '../../constants/zIndex';
import { clampToViewport } from './menuPosition';
import { isTopMenu, popMenu, pushMenu } from './menuStack';
import { useFeatureActive } from '../featureActive';

const ITEMS = '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])';

export interface MenuProps {
    'aria-label': string;
    onClose: () => void;
    /** Viewport point (context menus): portaled, fixed, clamped, above any dialog. */
    point?: { x: number; y: number };
    /** Size used to clamp a point menu. */
    estimatedSize?: { width: number; height: number };
    /** 'popover' for a menu the caller portals itself (player menus); default 'dropdown'. */
    layer?: 'dropdown' | 'popover';
    /** Focus returns here when the menu closes with focus inside it. */
    returnFocusRef?: React.RefObject<HTMLElement>;
    /** A mouse-down on these (the trigger) does not count as outside. */
    ignoreRefs?: React.RefObject<HTMLElement>[];
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}

/** The open menu; `Menu` renders it while its feature shows. */
const OpenMenu: React.FC<MenuProps> = ({
    'aria-label': ariaLabel, onClose, point, estimatedSize = { width: 200, height: 48 }, layer = 'dropdown',
    returnFocusRef, ignoreRefs, className, style, children,
}) => {
    const ref = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    // Real size, measured after mount; the estimate is only the first guess.
    const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);

    useEffect(() => {
        const menu = ref.current;
        const me = pushMenu();
        // Opening focuses the first enabled item (the menu pattern): an item with a disabled reason is
        // skipped unless every item has one, and a destructive item is never the opening focus (Enter
        // right after a right-click must not remove anything). With no other item the menu takes focus.
        const safe = Array.from(menu?.querySelectorAll<HTMLElement>(ITEMS) ?? []).filter((el) => !el.hasAttribute('data-destructive'));
        const first = safe.find((el) => el.getAttribute('aria-disabled') !== 'true') ?? safe[0];
        if (!first) clientLog('menu_open_focus', { target: 'menu', outcome: 'container' });
        (first ?? menu)?.focus({ preventScroll: true });
        const onDown = (e: MouseEvent) => {
            const target = e.target as Node;
            if (menu?.contains(target)) return;
            if (ignoreRefs?.some((r) => r.current?.contains(target))) return;
            onCloseRef.current();
        };
        // Capture phase: a menu inside a dialog closes before the dialog sees Escape.
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
            if (!isTopMenu(me)) return;
            e.preventDefault();
            onCloseRef.current();
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey, true);
        return () => {
            popMenu(me);
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey, true);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only
    }, []);

    // Layout cleanup runs while the menu is still in the DOM, so focus inside it is still known:
    // it goes back to the trigger before the browser drops it to the body.
    useLayoutEffect(() => {
        const menu = ref.current;
        const returnTo = returnFocusRef;
        return () => {
            if (menu && menu.contains(document.activeElement)) returnTo?.current?.focus({ preventScroll: true });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only
    }, []);

    useLayoutEffect(() => {
        if (!point) return;
        const rect = ref.current?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
            setMeasured((m) => (m && m.width === rect.width && m.height === rect.height ? m : { width: rect.width, height: rect.height }));
        }
    }, [point]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        // The menu is portaled, but React events bubble through the component tree: keep the keys
        // it handles away from a dialog around its trigger (viewer ← / → / ↑ / ↓).
        if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape', 'Tab', 'Enter', ' '].includes(e.key)) e.stopPropagation();
        if (e.key === 'Tab') { e.preventDefault(); onCloseRef.current(); return; } // focus goes back to the trigger; the next Tab moves on from there
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
        if (items.length === 0) return;
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next =
            e.key === 'Home' ? 0
            : e.key === 'End' ? items.length - 1
            : e.key === 'ArrowDown' ? (at + 1) % items.length
            : (at <= 0 ? items.length - 1 : at - 1);
        items[next].focus();
    };

    const position: React.CSSProperties = point
        ? { position: 'fixed', ...clampToViewport(point.x, point.y, measured ?? estimatedSize), zIndex: Z_INDEX.POPOVER }
        : { zIndex: layer === 'popover' ? Z_INDEX.POPOVER : Z_INDEX.DROPDOWN };

    const menu = (
        <div
            ref={ref}
            role="menu"
            aria-label={ariaLabel}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className={cn('flex min-w-44 flex-col rounded-card bg-card p-1 shadow-card outline-none', className)}
            style={{ ...position, ...style, left: point ? position.left : style?.left, top: point ? position.top : style?.top }}
        >
            {children}
        </div>
    );
    return point ? createPortal(menu, document.body) : menu;
};

/** Level-2 popover menu (docs/design/DESIGN_SYSTEM.md, "Menus"); nothing while its feature is hidden (as `Modal`). */
export const Menu: React.FC<MenuProps> = (props) => (useFeatureActive() ? <OpenMenu {...props} /> : null);

export interface MenuItemProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'role'> {
    icon?: React.ReactNode;
    /** Selected option (speed, loop): `text-accent-strong`, the selected-text role. */
    selected?: boolean;
    destructive?: boolean;
    /** One of a set of options: `menuitemradio` with `aria-checked`. */
    radio?: boolean;
    /**
     * Translated reason the item cannot be used now (spec §8: never grey out without a reason).
     * The item stays focusable (`aria-disabled`), shows the reason as tooltip and description,
     * keeps its colour at 40 %, and swallows clicks (logged as `menu_item_blocked`).
     */
    disabledReason?: string;
    /** `target` of the `menu_item_blocked` breadcrumb; `^[a-z0-9_]{1,40}$`. */
    logTarget?: string;
}

export const MenuItem = React.forwardRef<HTMLButtonElement, MenuItemProps>(
    ({ icon, selected = false, destructive = false, radio = false, disabledReason, logTarget, className, children, onClick, title, type = 'button', ...rest }, ref) => {
        const reasonId = useId();
        const reason = disabledReason || undefined;
        return (
            <button
                {...rest}
                ref={ref}
                type={type}
                data-destructive={destructive || undefined}
                role={radio ? 'menuitemradio' : 'menuitem'}
                aria-checked={radio ? selected : undefined}
                aria-disabled={reason !== undefined ? true : undefined}
                aria-describedby={reason !== undefined ? reasonId : undefined}
                title={reason ?? title}
                tabIndex={-1}
                className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-small',
                    // Keyboard focus: the section 9 accent ring, inset (the item fills the menu); hover keeps the grey.
                    'transition-colors duration-fast ease-standard hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                    'disabled:pointer-events-none disabled:opacity-40',
                    'aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent',
                    destructive ? 'text-status-danger' : selected ? 'font-semibold text-accent-strong' : 'text-primary',
                    className,
                )}
                onClick={reason !== undefined
                    ? (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        clientLog('menu_item_blocked', { target: logTarget ?? 'unknown' });
                    }
                    : onClick}
            >
                {icon && (
                    <span aria-hidden="true" className={cn('flex h-4 w-4 shrink-0 items-center justify-center', !destructive && !selected && 'text-secondary')}>
                        {icon}
                    </span>
                )}
                {children}
                {reason !== undefined && <span id={reasonId} aria-hidden="true" className="sr-only">{reason}</span>}
            </button>
        );
    },
);
MenuItem.displayName = 'MenuItem';

export const MenuLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div role="presentation" className="px-3 pb-1 pt-2 text-caption text-muted">{children}</div>
);

/** Space between groups of items: never a line (docs/design/DESIGN_SYSTEM.md, Do / Don't). */
export const MenuSeparator: React.FC = () => <div role="separator" className="h-2" />;
