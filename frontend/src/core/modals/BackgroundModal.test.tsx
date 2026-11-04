import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18n from '../../i18n';
import { BackgroundModal } from './BackgroundModal';
import { UI_CONSTANTS } from '../../config/uiConstants';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';

vi.mock('../../utils/backgroundSettings', async (orig) => ({
    ...(await orig<typeof import('../../utils/backgroundSettings')>()),
    saveBackgroundSettings: vi.fn(),
}));

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('BackgroundModal', () => {
    it('a preset is applied and reported', () => {
        const onSettingsChange = vi.fn();
        render(<BackgroundModal isOpen onClose={vi.fn()} conversationPath="hinatazaka46/messages/1 A/1 A" onSettingsChange={onSettingsChange} />);
        fireEvent.click(screen.getByTitle('#FEE2E2'));
        expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'color', color: '#FEE2E2' }));
    });

    it('Done closes', () => {
        const onClose = vi.fn();
        render(<BackgroundModal isOpen onClose={onClose} conversationPath="p" onSettingsChange={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(onClose).toHaveBeenCalled();
    });

    function upload(file: File) {
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(input, { target: { files: [file] } });
    }
    const bigImage = () => {
        const f = new File(['x'], 'big.png', { type: 'image/png' });
        Object.defineProperty(f, 'size', { value: UI_CONSTANTS.limits.maxImageSizeBytes + 1 });
        return f;
    };

    it('logs a too-large upload as skipped with its reason, never the file name', () => {
        vi.mocked(clientLog).mockClear();
        render(<BackgroundModal isOpen onClose={vi.fn()} conversationPath="p" onSettingsChange={vi.fn()} />);
        upload(bigImage());
        expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('background.imageTooLarge'));
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'background_upload', outcome: 'skipped', reason: 'too_large' });
        expect(JSON.stringify(vi.mocked(clientLog).mock.calls)).not.toContain('big.png');
    });

    it('logs a non-image upload as skipped with its reason', () => {
        vi.mocked(clientLog).mockClear();
        render(<BackgroundModal isOpen onClose={vi.fn()} conversationPath="p" onSettingsChange={vi.fn()} />);
        upload(new File(['x'], 'notes.txt', { type: 'text/plain' }));
        expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('background.selectImageFile'));
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'background_upload', outcome: 'skipped', reason: 'not_image' });
    });

    it('logs an accepted image as ok', async () => {
        vi.mocked(clientLog).mockClear();
        const onSettingsChange = vi.fn();
        render(<BackgroundModal isOpen onClose={vi.fn()} conversationPath="p" onSettingsChange={onSettingsChange} />);
        upload(new File(['x'], 'ok.png', { type: 'image/png' }));
        await waitFor(() => expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'image' })));
        expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'background_upload', outcome: 'ok' });
    });

    it('clears the upload error when the dialog closes', () => {
        const props = { onClose: vi.fn(), conversationPath: 'p', onSettingsChange: vi.fn() };
        const { rerender } = render(<BackgroundModal isOpen {...props} />);
        upload(bigImage());
        expect(screen.getByRole('alert')).toBeInTheDocument();
        rerender(<BackgroundModal isOpen={false} {...props} />);
        rerender(<BackgroundModal isOpen {...props} />);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('marks the selected preset with a ring offset on the surface colour', () => {
        render(<BackgroundModal isOpen onClose={vi.fn()} conversationPath="p" onSettingsChange={vi.fn()} />);
        fireEvent.click(screen.getByTitle('#FEE2E2'));
        expect(screen.getByTitle('#FEE2E2')).toHaveClass('ring-offset-2', 'ring-offset-surface');
    });
});
