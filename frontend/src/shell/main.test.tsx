import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('react-dom/client', () => ({ default: { createRoot: () => ({ render: vi.fn() }) } }));
vi.mock('../i18n', () => ({}));
vi.mock('../design/fonts', () => ({ installLanguageFonts: vi.fn() }));

describe('main entry', () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = '<div id="root"></div>';
    });
    afterEach(() => {
        vi.doUnmock('./App');
    });

    it('logs app_load_failed when the main route chunk fails to load', async () => {
        vi.doMock('./App', () => { throw new Error('chunk load failed'); });
        const { clientLog } = await import('../utils/clientLog');
        vi.mocked(clientLog).mockClear();
        await import('./main');
        await vi.waitFor(() =>
            expect(clientLog).toHaveBeenCalledWith('app_load_failed', { error_type: 'load_failed' }),
        );
    });
});
