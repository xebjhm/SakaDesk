import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Modal } from './Modal';
import { LiveRegion } from './LiveRegion';
import { resetDialogStack } from '../dialog/dialogStack';

describe('LiveRegion', () => {
    afterEach(() => resetDialogStack());

    it('is always in the document, empty until there is a message', () => {
        const { rerender } = render(<LiveRegion message="" />);
        const region = screen.getByRole('status');
        expect(region).toHaveAttribute('aria-live', 'polite');
        expect(region).toBeEmptyDOMElement();
        rerender(<LiveRegion message="コピーしました 📋" />);
        expect(screen.getByRole('status')).toBe(region);
        expect(region).toHaveTextContent('コピーしました 📋');
        expect(region).toHaveClass('sr-only');
    });

    it('stays outside every inert ancestor while a dialog is open, from #root or from inside a dialog', () => {
        const root = document.createElement('div');
        root.id = 'root';
        document.body.appendChild(root);
        try {
            render(
                <>
                    <LiveRegion message="app" />
                    <Modal isOpen onClose={() => {}} aria-label="viewer" layout="bare">
                        <LiveRegion message="viewer" />
                    </Modal>
                </>,
                { container: root },
            );
            expect(root).toHaveAttribute('inert');
            for (const region of screen.getAllByRole('status')) {
                expect(region.closest('[inert]')).toBeNull();
            }
            expect(screen.getAllByRole('status')).toHaveLength(2);
        } finally {
            root.remove();
        }
    });
});
