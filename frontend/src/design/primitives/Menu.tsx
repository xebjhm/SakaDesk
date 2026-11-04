import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/classnames';
import { Z_INDEX } from '../../constants/zIndex';
import { clampToViewport } from './menuPosition';
import { isTopMenu, popMenu, pushMenu } from './menuStack';

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

/** Level-2 popover menu (docs/design/DESIGN_SYSTEM.md, "Menus"). */
export const Menu: React.FC<MenuProps> = ({
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
        menu?.focus({ preventScroll: true });
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

export interface MenuItemProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'role'> {
    icon?: React.ReactNode;
    /** Selected option (speed, loop): `text-group-strong`, the selected-text role. */
    selected?: boolean;
    destructive?: boolean;
    /** One of a set of options: `menuitemradio` with `aria-checked`. */
    radio?: boolean;
}

export const MenuItem = React.forwardRef<HTMLButtonElement, MenuItemProps>(
    ({ icon, selected = false, destructive = false, radio = false, className, children, type = 'button', ...rest }, ref) => (
        <button
            ref={ref}
            type={type}
            role={radio ? 'menuitemradio' : 'menuitem'}
            aria-checked={radio ? selected : undefined}
            tabIndex={-1}
            className={cn(
                'flex w-full items-center gap-2 rounded-pill px-3 py-2 text-left text-small',
                'transition-colors duration-fast ease-standard hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none',
                'disabled:pointer-events-none disabled:text-muted',
                destructive ? 'text-status-danger' : selected ? 'font-semibold text-group-strong' : 'text-primary',
                className,
            )}
            {...rest}
        >
            {icon && (
                <span aria-hidden="true" className={cn('flex h-4 w-4 shrink-0 items-center justify-center', !destructive && !selected && 'text-secondary')}>
                    {icon}
                </span>
            )}
            {children}
        </button>
    ),
);
MenuItem.displayName = 'MenuItem';

export const MenuLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div role="presentation" className="px-3 pb-1 pt-2 text-caption text-muted">{children}</div>
);

/** Space between groups of items: never a line (docs/design/DESIGN_SYSTEM.md, Do / Don't). */
export const MenuSeparator: React.FC = () => <div role="separator" className="h-2" />;
