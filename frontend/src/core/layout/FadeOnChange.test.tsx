import { describe, it, expect } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FadeOnChange } from './FadeOnChange';

const Counter: React.FC = () => {
    const [n, setN] = useState(0);
    return <button type="button" onClick={() => setN(n + 1)}>count {n}</button>;
};

describe('FadeOnChange', () => {
    it('keeps its children mounted (and their state) when the key changes', () => {
        const { rerender } = render(<FadeOnChange changeKey="a"><Counter /></FadeOnChange>);
        fireEvent.click(screen.getByRole('button'));
        rerender(<FadeOnChange changeKey="b"><Counter /></FadeOnChange>);
        expect(screen.getByRole('button')).toHaveTextContent('count 1');
    });

    it('passes the className through', () => {
        const { container } = render(<FadeOnChange changeKey="a" className="flex-1"><span /></FadeOnChange>);
        expect(container.firstChild).toHaveClass('flex-1');
    });
});
