import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { memoryMessage, MEMBER_PATH } from '../__fixtures__/memories';
import { resurfaceItem } from '../capsule/__fixtures__';
import { HubSlots } from './HubSlots';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const SAME_TIME = {
    clock: '21:03', year: 2024, date: '2024-06-02', member_path: MEMBER_PATH, name: '金村 美玖',
    message: memoryMessage({ id: 5, text: 'いま帰ってきたよ' }),
};

describe('HubSlots', () => {
    it('renders nothing for null same-time and capsule slots', () => {
        const { container } = render(<HubSlots service="hinatazaka46" go={vi.fn()} sameTime={null} capsule={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('keeps the card it wraps in place', () => {
        const { getByText } = render(
            <HubSlots service="hinatazaka46" go={vi.fn()} sameTime={null} capsule={null}><p>card</p></HubSlots>,
        );
        expect(getByText('card')).toBeInTheDocument();
    });

    it('draws the same-time line above the card and the resurfaced note below it', () => {
        render(
            <HubSlots service="hinatazaka46" go={vi.fn()} sameTime={SAME_TIME} capsule={resurfaceItem()}>
                <p data-testid="otd-card">card</p>
            </HubSlots>,
        );
        const line = screen.getByTestId('memories-same-time');
        const card = screen.getByTestId('otd-card');
        const note = screen.getByTestId('capsule-resurface');
        expect(line.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(card.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(note).toHaveTextContent('1年前のあなたが書いたメモ');
    });
});
