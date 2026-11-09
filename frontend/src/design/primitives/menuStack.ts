/** Open menus, oldest first: only the last one answers Escape (docs/design/DESIGN_SYSTEM.md, "Menus"). */
let openMenus: symbol[] = [];

/** Put a newly opened menu on top; returns its token. */
export function pushMenu(): symbol {
    const me = Symbol('menu');
    openMenus.push(me);
    return me;
}

export function popMenu(me: symbol): void {
    const at = openMenus.indexOf(me);
    if (at >= 0) openMenus.splice(at, 1);
}

export function isTopMenu(me: symbol): boolean {
    return openMenus[openMenus.length - 1] === me;
}

/** Test helper: forget every open menu. */
export function resetMenuStack(): void {
    openMenus = [];
}
