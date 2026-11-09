import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { SERVICE_FEATURES, getAvailableFeatures } from '../../config/features';
import { MemoriesFeature } from './MemoriesFeature';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('Memories feature', () => {
    it('is offered for every service', () => {
        for (const service of [...Object.keys(SERVICE_FEATURES), 'someunknown']) {
            expect(getAvailableFeatures(service).map(f => f.id)).toContain('memories');
        }
    });

    it('opens on the home hub with the recap card', () => {
        render(<MemoriesFeature service="hinatazaka46" />);
        expect(screen.getByTestId('memories-home')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Year recap/ })).toBeInTheDocument();
    });

    it('switches to the recap page when the recap card is clicked', async () => {
        render(<MemoriesFeature service="hinatazaka46" />);
        await userEvent.click(screen.getByRole('button', { name: /Year recap/ }));
        expect(screen.getByTestId('recap-entry')).toBeInTheDocument();
        expect(screen.queryByTestId('memories-home')).toBeNull();
    });

    it('resets to home when the service changes', async () => {
        const { rerender } = render(<MemoriesFeature service="hinatazaka46" />);
        await userEvent.click(screen.getByRole('button', { name: /Year recap/ }));
        expect(screen.getByTestId('recap-entry')).toBeInTheDocument();
        rerender(<MemoriesFeature service="sakurazaka46" />);
        expect(screen.getByTestId('memories-home')).toBeInTheDocument();
    });
});
