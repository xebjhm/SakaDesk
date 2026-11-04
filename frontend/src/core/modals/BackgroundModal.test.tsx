import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '../../i18n';
import { BackgroundModal } from './BackgroundModal';

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
});
