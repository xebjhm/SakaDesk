import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '../../i18n';
import { TosDialog } from './TosDialog';
import { SetupWizard } from './SetupWizard';
import { LoginModal } from './LoginModal';
import { resetDialogStack } from '../../design/dialog/dialogStack';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => resetDialogStack());

describe('entry-flow shells (content is D2d)', () => {
    it('ToS is a modal dialog that Escape does not close', () => {
        const onAccept = vi.fn();
        render(<TosDialog onAccept={onAccept} />);
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAccessibleName();
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(onAccept).not.toHaveBeenCalled();
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
