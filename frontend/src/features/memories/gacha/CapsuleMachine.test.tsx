import { describe, it, expect, beforeAll, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { CapsuleMachine, type CapsuleMachineProps } from './CapsuleMachine';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

function renderMachine(over: Partial<CapsuleMachineProps> = {}) {
    const onPull = vi.fn();
    const props: CapsuleMachineProps = { pullsLeft: 2, busy: false, onPull, dropped: null, reducedMotion: false, ...over };
    const utils = render(<CapsuleMachine {...props} />);
    return { onPull, ...utils };
}

const knob = () => screen.getByRole('button', { name: 'ハンドルを回す' });

/** Drag the knob around its centre (jsdom lays it out at 0,0) through the given angles in degrees. */
function drag(el: HTMLElement, degrees: number[]) {
    const at = (deg: number) => {
        const rad = (deg * Math.PI) / 180;
        return { clientX: Math.cos(rad) * 20, clientY: Math.sin(rad) * 20, pointerId: 1 };
    };
    fireEvent.pointerDown(el, at(degrees[0] ?? 0));
    for (const d of degrees.slice(1)) fireEvent.pointerMove(el, at(d));
    fireEvent.pointerUp(el, at(degrees[degrees.length - 1] ?? 0));
    fireEvent.click(el);
}

describe('CapsuleMachine', () => {
    it('pulls once on a click', async () => {
        const { onPull } = renderMachine();
        await userEvent.click(knob());
        expect(onPull).toHaveBeenCalledTimes(1);
    });

    it('pulls on Enter and on Space when focused', async () => {
        const { onPull } = renderMachine();
        knob().focus();
        await userEvent.keyboard('{Enter}');
        await userEvent.keyboard(' ');
        expect(onPull).toHaveBeenCalledTimes(2);
    });

    it('a drag of less than 270° does not pull (nor does the click that ends it)', () => {
        const { onPull } = renderMachine();
        drag(knob(), [0, 60, 120, 180, 240]);
        expect(onPull).not.toHaveBeenCalled();
    });

    it('a drag past 270° pulls exactly once', () => {
        const { onPull } = renderMachine();
        drag(knob(), [0, 60, 120, 180, 240, 300, 330]);
        expect(onPull).toHaveBeenCalledTimes(1);
    });

    it('after a drag pull the knob rests on the next whole turn forward, never spinning back', () => {
        renderMachine();
        drag(knob(), [0, 60, 120, 180, 240, 300, 330]);
        expect(knob().style.transform).toBe('rotate(360deg)');
    });

    it('a counter-clockwise drag pull rests a whole turn the other way', () => {
        renderMachine();
        drag(knob(), [0, -60, -120, -180, -240, -300]);
        expect(knob().style.transform).toBe('rotate(-360deg)');
    });

    it('a short drag springs back to where it started', () => {
        renderMachine();
        drag(knob(), [0, 60, 120]);
        expect(knob().style.transform).toBe('rotate(0deg)');
    });

    it('counts a drag across the ±180° seam as continuous rotation', () => {
        const { onPull } = renderMachine();
        // atan2 jumps from +180 to -180 here; unwrapped it is 90 → 380.
        drag(knob(), [90, 150, 179, 200, 260, 320, 380]);
        expect(onPull).toHaveBeenCalledTimes(1);
    });

    it('is disabled while a pull is in flight', async () => {
        const { onPull } = renderMachine({ busy: true });
        expect(knob()).toHaveAttribute('aria-disabled', 'true');
        await userEvent.click(knob());
        knob().focus();
        await userEvent.keyboard('{Enter}');
        expect(onPull).not.toHaveBeenCalled();
    });

    it('shows the pulls left under the knob', () => {
        renderMachine({ pullsLeft: 2 });
        expect(screen.getByText('今日はあと 2 回')).toBeInTheDocument();
    });

    it('with no pulls left it is disabled and says また明日, never 0', async () => {
        const { onPull, container } = renderMachine({ pullsLeft: 0 });
        expect(knob()).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByText('また明日')).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/0/);
        await userEvent.click(knob());
        expect(onPull).not.toHaveBeenCalled();
    });

    it('drops the capsule in its rarity colour', () => {
        renderMachine({ dropped: { key: 'a', rarity: 'sr' } });
        const capsule = screen.getByTestId('gacha-capsule');
        expect(capsule.innerHTML).toContain('bg-memories-rarity-sr');
        expect(capsule).toHaveAttribute('data-motion', 'roll');
    });

    it('fades the capsule in under reduced motion', () => {
        renderMachine({ dropped: { key: 'a', rarity: 'r' }, reducedMotion: true });
        const capsule = screen.getByTestId('gacha-capsule');
        expect(capsule.innerHTML).toContain('bg-memories-rarity-r');
        expect(capsule).toHaveAttribute('data-motion', 'fade');
    });
});
