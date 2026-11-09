import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import i18n from '../../i18n';
import { TosDialog } from './TosDialog';
import { SetupWizard } from './SetupWizard';
import { LoginModal } from './LoginModal';
import { SyncModal } from './SyncModal';
import type { SyncProgress } from '../../features/messages/MessagesFeature';
import { resetDialogStack } from '../../design/dialog/dialogStack';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => resetDialogStack());

const RUNNING: SyncProgress = {
    state: 'running', phase: 'scanning', phase_name: 'Scanning', phase_number: 1, completed: 5, total: 20,
    elapsed_seconds: 30, eta_seconds: 90, speed: 2.5, speed_unit: 'groups',
};

/** Press Escape on the page; true when a dialog claimed it (a non-dismissible one must not). */
function escapeIsClaimed(): boolean {
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { document.body.dispatchEvent(ev); });
    return ev.defaultPrevented;
}

describe('entry-flow shells (content is D2d)', () => {
    it('ToS is a named modal dialog that Escape and a backdrop click leave open', () => {
        render(<TosDialog onAccept={vi.fn()} />);
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAccessibleName();
        expect(escapeIsClaimed()).toBe(false);
        fireEvent.mouseDown(screen.getByTestId('modal-backdrop'));
        fireEvent.click(screen.getByTestId('modal-backdrop'));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('setup is not dismissible: Escape (unclaimed) and a backdrop click leave it open', () => {
        const onComplete = vi.fn();
        render(
            <SetupWizard outputDirInput="C:\\データ" setOutputDirInput={vi.fn()} setupBlogFullBackup={false}
                setSetupBlogFullBackup={vi.fn()} onSelectFolder={vi.fn()} onComplete={onComplete} isValid />,
        );
        expect(escapeIsClaimed()).toBe(false);
        fireEvent.mouseDown(screen.getByTestId('modal-backdrop'));
        fireEvent.click(screen.getByTestId('modal-backdrop'));
        expect(screen.getByRole('dialog', { name: /Welcome/i })).toBeInTheDocument();
        expect(onComplete).not.toHaveBeenCalled();
    });

    it('a running sync is not dismissible: Escape and a backdrop click never call onClose', () => {
        const onClose = vi.fn();
        render(<SyncModal syncProgress={RUNNING} onClose={onClose} />);
        expect(escapeIsClaimed()).toBe(false);
        fireEvent.mouseDown(screen.getByTestId('modal-backdrop'));
        fireEvent.click(screen.getByTestId('modal-backdrop'));
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('the setup wizard is a named modal dialog', () => {
        render(
            <SetupWizard outputDirInput="C:\\データ" setOutputDirInput={vi.fn()} setupBlogFullBackup={false}
                setSetupBlogFullBackup={vi.fn()} onSelectFolder={vi.fn()} onComplete={vi.fn()} isValid />,
        );
        expect(screen.getByRole('dialog', { name: /Welcome/i })).toHaveAttribute('aria-modal', 'true');
    });

    it('login is a dismissible modal dialog', () => {
        const onClose = vi.fn();
        render(<LoginModal serviceId="hinatazaka46" featureId="messages" onClose={onClose} onSuccess={vi.fn()} />);
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });
});
