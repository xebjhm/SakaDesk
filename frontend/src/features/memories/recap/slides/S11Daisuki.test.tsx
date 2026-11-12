import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import i18n from '../../../../i18n';
import { S11Daisuki } from './S11Daisuki';
import { daisukiData, payload } from '../__fixtures__/payload';
import type { S11DaisukiData } from '../api';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const renderS11 = (data: S11DaisukiData, opts: { reducedMotion?: boolean; paused?: boolean; fallback?: string | null } = {}) =>
    render(
        <S11Daisuki
            data={data} fallback={opts.fallback ?? null} recap={payload()} nickname="ゆき"
            reducedMotion={opts.reducedMotion ?? false} paused={opts.paused ?? false} onMediaEnd={() => {}}
        />,
    );

describe('S11Daisuki', () => {
    it('petals of her phrases fall, then settle on one full message', () => {
        renderS11(daisukiData());
        expect(screen.getByText('大好き と ありがとう。')).toHaveAttribute('data-voice', 'title');
        const petals = screen.getAllByTestId('s11-petal');
        expect(petals).toHaveLength(3);
        for (const p of petals) expect(p.className).toMatch(/\banimate-petal-fall\b/);
        expect(screen.getByText('ゆき、ありがとう')).toHaveAttribute('data-voice', 'quote');
        const final = screen.getByTestId('s11-final');
        expect(final).toHaveTextContent('ゆき、大好き。いつもありがとう。');
        expect(final.querySelector('[data-voice="quote"]')).not.toBeNull();
    });

    it('petals and the final message freeze while paused', () => {
        renderS11(daisukiData(), { paused: true });
        for (const p of screen.getAllByTestId('s11-petal')) expect(p.style.animationPlayState).toBe('paused');
        expect(screen.getByTestId('s11-final').style.animationPlayState).toBe('paused');
    });

    it('reduced motion: the petals are static', () => {
        renderS11(daisukiData(), { reducedMotion: true });
        for (const p of screen.getAllByTestId('s11-petal')) {
            expect(p.className).not.toMatch(/animate-/);
            expect(p.style.animationDelay).toBe('');
        }
        expect(screen.getByTestId('s11-final').className).not.toMatch(/animate-/);
    });

    it('petal motion carries the reduced-motion variant too', () => {
        renderS11(daisukiData());
        for (const p of screen.getAllByTestId('s11-petal')) expect(p.className).toMatch(/motion-reduce:animate-none/);
    });

    it('the joy variant names neither 大好き nor ありがとう in its title', () => {
        renderS11(daisukiData({ variant: 'joy', petals: [{ text: '楽しかった', date: '2026-04-01' }] }), { fallback: 'joy' });
        expect(screen.getByText('あたたかい、ことばたち。')).toBeInTheDocument();
        expect(screen.queryByText(/大好き と/)).toBeNull();
    });

    it('no final message: only the petals, never null', () => {
        renderS11(daisukiData({ final: null }));
        expect(screen.queryByTestId('s11-final')).toBeNull();
        expect(screen.getAllByTestId('s11-petal')).toHaveLength(3);
        expect(document.body.textContent).not.toMatch(/null|undefined/);
    });

    it('keeps every petal out of the title and the message: they lie in bands above and below (D6)', () => {
        renderS11(daisukiData());
        const top = screen.getByTestId('s11-band-top');
        const bottom = screen.getByTestId('s11-band-bottom');
        const title = screen.getByText('大好き と ありがとう。');
        for (const p of screen.getAllByTestId('s11-petal')) {
            expect(top.contains(p) || bottom.contains(p)).toBe(true);
        }
        expect(within(top).getAllByTestId('s11-petal').length).toBeGreaterThan(0);
        expect(within(bottom).getAllByTestId('s11-petal').length).toBeGreaterThan(0);
        expect(top.contains(title) || bottom.contains(title)).toBe(false);
        // Document order: band, title, message, band.
        const final = screen.getByTestId('s11-final');
        expect(top.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(final.compareDocumentPosition(bottom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('positions are stable between renders', () => {
        const a = renderS11(daisukiData());
        const first = screen.getAllByTestId('s11-petal').map((p) => p.style.left + p.style.top);
        a.unmount();
        renderS11(daisukiData());
        expect(screen.getAllByTestId('s11-petal').map((p) => p.style.left + p.style.top)).toEqual(first);
    });
});
