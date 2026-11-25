import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InlineSyncView } from './InlineSyncView';
import type { SyncProgress } from '../../features/messages/MessagesFeature';

const lang = vi.hoisted(() => ({ current: 'en' }));
// The keys come back as-is; only the language (used for number formatting) varies.
vi.mock('../../i18n', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: lang.current },
    }),
}));

vi.mock('../common/SyncProgressPanel', () => ({ SyncProgressPanel: () => null }));

const progress: SyncProgress = {
    state: 'running',
    phase: 'scanning',
    phase_name: 'Scanning',
    phase_number: 1,
    completed: 5,
    total: 12345,
    elapsed_seconds: 30,
    eta_seconds: 90,
    speed: 2.5,
    speed_unit: 'groups',
};

describe('InlineSyncView', () => {
    it.each([['en', '12,345'], ['de', '12.345']])('formats the item count with the UI language (%s)', (language, formatted) => {
        lang.current = language;
        try {
            render(<InlineSyncView service="hinatazaka46" syncProgress={progress} />);
            expect(screen.getByText(`${formatted} sync.items`)).toBeInTheDocument();
        } finally {
            lang.current = 'en';
        }
    });
});
