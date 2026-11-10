import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchNameMoments: vi.fn() };
});
import { fetchNameMoments } from '../api';
import { MEMBER_PATH, memoryMessage } from '../__fixtures__/memories';
import { NameMoments } from './NameMoments';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

// The real react-virtuoso (no mock): a heavy user's ~1,500 moments are windowed, not all mounted.
describe('NameMoments windowing', () => {
    it('mounts only a window of a long list', async () => {
        vi.mocked(fetchNameMoments).mockResolvedValue({
            years: [2024],
            items: Array.from({ length: 1500 }, (_, i) => ({
                message: memoryMessage({ id: i + 1, ts: '2024-09-14T12:52:00Z' }),
                sentence: `%%%、${i}`,
            })),
        });
        render(<NameMoments service="hinatazaka46" memberPath={MEMBER_PATH} name="金村 美玖" onBack={() => {}} />);
        expect(await screen.findByTestId('name-moments-list')).toBeInTheDocument();
        expect(screen.queryAllByTestId('name-moment').length).toBeLessThan(100);
    });
});
