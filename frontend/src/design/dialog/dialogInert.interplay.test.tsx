import { StrictMode, useEffect, useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { Modal } from '../primitives/Modal';
import { KeepMounted } from '../../core/layout/KeepMounted';
import { resetDialogStack } from './dialogStack';

let setOpenOuter: (v: boolean) => void = () => {};
let setActiveOuter: (v: boolean) => void = () => {};

/** A dialog inside a kept-mounted feature, plus a plain dialog, as the app mounts them. */
function Harness() {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(true);
    useEffect(() => {
        setOpenOuter = setOpen;
        setActiveOuter = setActive;
    }, []);
    return (
        <div id="root">
            <KeepMounted active={active}>
                <Modal isOpen={open} onClose={() => setOpen(false)} title="Inside" closeLabel="x">body</Modal>
            </KeepMounted>
        </div>
    );
}

describe('#root inert composes with the dialog layer and KeepMounted', () => {
    afterEach(() => resetDialogStack());

    // The harness's own div is the #root under test; Modal portals into <body> outside it.
    const mount = () => render(<StrictMode><Harness /></StrictMode>);

    it('releases #root when the last dialog closes, keeping a hidden feature inert', () => {
        mount();
        const root = document.getElementById('root') as HTMLElement;
        const kept = document.querySelector('[data-testid="kept-feature"]') as HTMLElement;
        act(() => setOpenOuter(true));
        expect(root).toHaveAttribute('inert');
        act(() => setOpenOuter(false));
        expect(root).not.toHaveAttribute('inert');
        expect(kept).not.toHaveAttribute('inert');
    });

    it('releases #root when the dialog unmounts because its feature got hidden', () => {
        mount();
        const root = document.getElementById('root') as HTMLElement;
        const kept = document.querySelector('[data-testid="kept-feature"]') as HTMLElement;
        act(() => setOpenOuter(true));
        expect(root).toHaveAttribute('inert');
        act(() => setActiveOuter(false));
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(root).not.toHaveAttribute('inert');
        expect(kept).toHaveAttribute('inert');
        act(() => setActiveOuter(true));
        expect(kept).not.toHaveAttribute('inert');
        expect(root).toHaveAttribute('inert');
    });
});
