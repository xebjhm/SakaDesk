import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchRadioCassettes: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { fetchRadioCassettes } from '../api';
import { CassetteShelf } from './CassetteShelf';
import { cassettesPayload, MEMBER_PATH } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    vi.mocked(fetchRadioCassettes).mockReset().mockResolvedValue(cassettesPayload(['#cfe3f7', null, '#d6efe0']));
});

describe('CassetteShelf', () => {
    it('draws one tape per year with its length, the year colour on the label, a neutral tape for null', async () => {
        render(<CassetteShelf service="hinatazaka46" member={MEMBER_PATH} selectedYear={2024} onLoad={vi.fn()} />);
        const tapes = await screen.findAllByTestId('cassette');
        expect(tapes).toHaveLength(3);
        expect(vi.mocked(fetchRadioCassettes).mock.calls[0]?.[1]).toBe(MEMBER_PATH);
        expect(tapes[0]).toHaveTextContent('2023 tape');
        expect(tapes[0]).toHaveTextContent('32 min');
        expect(tapes[1]).toHaveTextContent('1 h 25 min');
        expect(screen.getAllByTestId('cassette-shell')[0]).toHaveStyle({ backgroundColor: '#cfe3f7' });
        const neutral = screen.getAllByTestId('cassette-shell')[1];
        expect(neutral).toHaveAttribute('data-tone', 'neutral');
        expect(neutral.getAttribute('style') ?? '').not.toMatch(/background/);
        expect(tapes[1]).toHaveAttribute('aria-pressed', 'true');
        expect(tapes[0]).toHaveAttribute('aria-pressed', 'false');
    });

    it('moves with ← / → (older / newer) and loads a year with Enter', async () => {
        const onLoad = vi.fn();
        render(<CassetteShelf service="hinatazaka46" selectedYear={2024} onLoad={onLoad} />);
        const tapes = await screen.findAllByTestId('cassette');
        // One Tab stop: the selected tape.
        expect(tapes.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
        tapes[1].focus();
        await userEvent.keyboard('{ArrowLeft}');
        expect(document.activeElement).toBe(tapes[0]);
        await userEvent.keyboard('{ArrowLeft}');
        expect(document.activeElement).toBe(tapes[0]);
        await userEvent.keyboard('{ArrowRight}{ArrowRight}');
        expect(document.activeElement).toBe(tapes[2]);
        await userEvent.keyboard('{Enter}');
        expect(onLoad).toHaveBeenCalledWith(2025);
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'cassette', outcome: 'on' });
    });

    it('draws nothing without cassettes', async () => {
        vi.mocked(fetchRadioCassettes).mockResolvedValue({ cassettes: [] });
        const { container } = render(<CassetteShelf service="hinatazaka46" selectedYear={null} onLoad={vi.fn()} />);
        await vi.waitFor(() => expect(fetchRadioCassettes).toHaveBeenCalled());
        await Promise.resolve();
        expect(screen.queryByTestId('cassette')).toBeNull();
        expect(container.textContent).not.toMatch(/0/);
    });
});
