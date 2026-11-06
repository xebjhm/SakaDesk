import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../__tests__/mocks/server';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { useAppStore } from '../store/appStore';
import { persisted } from '../core/persistence/persisted';

vi.mock('../core/layout', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../core/layout')>()),
    Layout: () => <div data-testid="layout-stub" />,
}));

function pinPrefs(tosAccepted: boolean) {
    vi.spyOn(persisted, 'getPref').mockImplementation(<T,>(key: string, fallback: T): T => {
        if (key === 'tos_accepted_at') return (tosAccepted ? '2024-01-01T00:00:00Z' : fallback) as unknown as T;
        if (key === 'language') return 'en' as unknown as T;
        return fallback;
    });
}

describe('first launch on the brand atmosphere (R-d)', () => {
    beforeEach(() => {
        server.use(
            http.get('*/api/app-state/prefs', () => HttpResponse.json({})),
            http.patch('*/api/app-state/prefs', () => HttpResponse.json({ ok: true })),
            http.get('*/api/app-state/migrate', () => HttpResponse.json({ migrated: true })),
            http.get('*/api/app-state/conversation-all', () => HttpResponse.json({})),
        );
    });

    it('the boot screen is brand with an ink spinner (pending decision D7)', () => {
        pinPrefs(false);
        useAppStore.setState({ selectedServices: [], activeService: null });
        const { unmount } = render(<AuthProvider><App /></AuthProvider>);
        const boot = screen.getByTestId('boot-screen');
        expect(boot.closest('[data-scope="brand"]')).not.toBeNull();
        expect(boot.querySelector('svg')).toHaveClass('animate-spin', 'text-accent');
        unmount();
    });

    it('ToS sits on the brand orbs', async () => {
        pinPrefs(false);
        useAppStore.setState({ selectedServices: [], activeService: null });
        const { unmount } = render(<AuthProvider><App /></AuthProvider>);
        expect(await screen.findByRole('dialog', { name: 'Terms of Service' })).toHaveAttribute('data-scope', 'brand');
        const backdrop = screen.getByTestId('entry-backdrop');
        expect(backdrop.querySelector('[data-scope="brand"]')).not.toBeNull();
        expect(backdrop.querySelectorAll('[data-testid="atmosphere-orb"]')).toHaveLength(3);
        unmount();
    });
});
