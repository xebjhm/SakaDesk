import { Z_INDEX } from '../../constants/zIndex';

/** One open dialog. `node` returns its frame (for the focus trap). */
export interface DialogEntry {
    readonly id: number;
    readonly node: () => HTMLElement | null;
    readonly dismissible: boolean;
}

let nextId = 1;
let stack: DialogEntry[] = [];
let savedOverflow: string | null = null;

/** Opens a dialog on top; the first one locks body scroll. */
export function pushDialog(entry: Omit<DialogEntry, 'id'>): DialogEntry {
    const full: DialogEntry = { ...entry, id: nextId++ };
    if (stack.length === 0) {
        savedOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
    }
    stack = [...stack, full];
    return full;
}

/** Closes a dialog wherever it is in the stack; the last one restores body scroll. */
export function popDialog(entry: DialogEntry): void {
    if (!stack.some((e) => e.id === entry.id)) return;
    stack = stack.filter((e) => e.id !== entry.id);
    if (stack.length === 0) {
        document.body.style.overflow = savedOverflow ?? '';
        savedOverflow = null;
    }
}

export function isTopDialog(entry: DialogEntry): boolean {
    return stack.length > 0 && stack[stack.length - 1].id === entry.id;
}

/** z-index of a dialog: Z_INDEX.DIALOG for the first, one DIALOG_STEP higher per dialog below it. */
export function dialogZIndex(entry: DialogEntry): number {
    const depth = Math.max(0, stack.findIndex((e) => e.id === entry.id));
    return Z_INDEX.DIALOG + depth * Z_INDEX.DIALOG_STEP;
}

export function openDialogCount(): number {
    return stack.length;
}

/** Test helper: forget every dialog and unlock scroll. */
export function resetDialogStack(): void {
    if (stack.length > 0) document.body.style.overflow = savedOverflow ?? '';
    stack = [];
    savedOverflow = null;
}
