import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HubSlots } from './HubSlots';

describe('HubSlots', () => {
    it('renders nothing for null same-time and capsule slots (wave 4 fills them)', () => {
        const { container } = render(<HubSlots sameTime={null} capsule={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('keeps the card it wraps in place', () => {
        const { getByText } = render(<HubSlots sameTime={null} capsule={null}><p>card</p></HubSlots>);
        expect(getByText('card')).toBeInTheDocument();
    });
});
