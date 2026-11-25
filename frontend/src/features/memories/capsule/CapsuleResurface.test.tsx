import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
import { memoryMessage } from '../__fixtures__/memories';
import { NicknameProvider } from '../shared/useNickname';
import { CapsuleResurface } from './CapsuleResurface';
import { capsuleNote, resurfaceItem } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('ja'); });
beforeEach(() => { vi.mocked(clientLog).mockClear(); });

function renderItem(item = resurfaceItem()) {
    const go = vi.fn();
    render(<NicknameProvider nickname="みーぱん"><CapsuleResurface item={item} go={go} /></NicknameProvider>);
    return go;
}

describe('CapsuleResurface', () => {
    it('shows the literal years-ago line, the note and her words of that day with its JST date', () => {
        renderItem(resurfaceItem({ years_ago: 2 }));
        expect(screen.getByText('2年前のあなたが書いたメモ')).toBeInTheDocument();
        expect(screen.getByTestId('capsule-note-7')).toHaveTextContent('はじめての握手会🌸');
        const words = screen.getByTestId('memory-text');
        expect(words).toHaveAttribute('lang', 'ja');
        expect(words).toHaveTextContent('みーぱん、今日はありがとう');
        expect(screen.getByTestId('capsule-resurface-message')).toHaveTextContent('2024');
        expect(screen.getByTestId('capsule-resurface-message')).toHaveTextContent('21:52');
    });

    it('opens On This Day for the anchor date from her message and logs `resurface_open`', async () => {
        const go = renderItem();
        await userEvent.click(screen.getByTestId('capsule-resurface-message'));
        expect(go).toHaveBeenCalledWith({ page: 'onThisDay', monthDay: '09-14', year: 2024 });
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_capsule', { phase: 'resurface_open', kind: 'day' });
    });

    it('shows a thumb when her message is a photo', () => {
        renderItem(resurfaceItem({
            message: memoryMessage({ id: 42, type: 'picture', text: null, caption: '海！', media_url: '/api/content/media/hinatazaka46/p.jpg' }),
        }));
        expect(within(screen.getByTestId('capsule-resurface-message')).getByTestId('memory-thumb')).toBeInTheDocument();
        expect(screen.getByTestId('memory-text')).toHaveTextContent('海！');
    });

    it('resurfaces the note alone when that day has no words of hers', () => {
        renderItem(resurfaceItem({ message: null, note: capsuleNote({ id: 9 }) }));
        expect(screen.getByTestId('capsule-note-9')).toBeInTheDocument();
        expect(screen.getByText('1年前のあなたが書いたメモ')).toBeInTheDocument();
        expect(screen.queryByTestId('capsule-resurface-message')).toBeNull();
    });

    it('names her on a card note that resurfaces without a message', () => {
        renderItem(resurfaceItem({
            message: null, name: '金村 美玖',
            note: capsuleNote({ id: 10, anchor: { kind: 'card', date: '2024-09-14', card_key: 'anniv.y1' } }),
        }));
        expect(screen.getByText('金村 美玖')).toHaveAttribute('lang', 'ja');
    });
});
