import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18n from '../i18n';
import { color } from './tokens/color';
import { contrastRatio } from './contrast';
import { BackgroundModal } from '../core/modals/BackgroundModal';
import { LazyVideo } from '../core/media/LazyVideo';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('grey text on grey surfaces (R-h task 6)', () => {
    it('text-secondary reaches 4.5:1 on every grey fill it sits on', () => {
        for (const bg of ['#F2F2F2', color.surface.sunken, '#E2E6EB']) {
            expect(contrastRatio(color.text.secondary, bg)).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('the background preview label is text-secondary and outside the dimmed fill', () => {
        render(<BackgroundModal isOpen onClose={vi.fn()} conversationPath="p" onSettingsChange={vi.fn()} />);
        const label = screen.getByText('Preview');
        expect(label).toHaveClass('text-secondary');
        expect(label).not.toHaveClass('text-muted');
        expect(screen.getByTestId('background-preview-fill')).not.toContainElement(label);
        expect(screen.getByTestId('background-preview')).toContainElement(label);
    });

    it('the lazy video placeholder icon is text-secondary', () => {
        vi.stubGlobal('IntersectionObserver', class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
        const { container } = render(<LazyVideo src="/v.mp4" />);
        expect(container.querySelector('svg')).toHaveClass('text-secondary');
        vi.unstubAllGlobals();
    });

    it('the search footer uses text-secondary on bg-sunken', () => {
        const src = readFileSync(resolve(__dirname, '../features/search/SearchModal.tsx'), 'utf-8');
        expect(src).toMatch(/bg-sunken px-4 py-2 text-caption text-secondary/);
    });
});
