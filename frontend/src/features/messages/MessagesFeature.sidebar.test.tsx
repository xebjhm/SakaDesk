import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { clientLog } from '../../utils/clientLog';
import { MessagesFeature } from './MessagesFeature';
import { popDialog, pushDialog, resetDialogStack } from '../../design/dialog/dialogStack';

vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../blogs', () => ({ BlogsFeature: () => <div>blogs</div> }));
vi.mock('../memories', () => ({ MemoriesFeature: () => <div>memories</div> }));
vi.mock('../../utils/clientLog', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../utils/clientLog')>()),
    clientLog: vi.fn(),
}));
// The list is not under test: two rooms, the first one selected.
vi.mock('./components/MemberList', () => ({
    MemberList: ({ onSelectGroup }: { onSelectGroup: (d: string, g: boolean, n: string) => void }) => (
        <div>
            <button onClick={() => onSelectGroup('日向坂46/messages/34 金村 美玖/58 金村 美玖', false, '金村 美玖')}>current room</button>
            <button onClick={() => onSelectGroup('日向坂46/messages/35 小坂 菜緒/59 小坂 菜緒', false, '小坂 菜緒')}>other room</button>
        </div>
    ),
}));

const SERVICE = 'hinatazaka46';
const ROOM = '日向坂46/messages/34 金村 美玖/58 金村 美玖';

const narrow = (on: boolean) => vi.stubGlobal('matchMedia', () => ({
    matches: on, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
}));
const sidebar = () => document.querySelector('div.fixed.inset-y-0.left-0.z-30') as HTMLElement;
const toggle = () => screen.getByRole('button', { name: i18n.t('messageList.openConversations') });

describe('MessagesFeature narrow member sidebar, keyboard (UI health A-D6)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        vi.mocked(clientLog).mockClear();
        narrow(true);
        useAppStore.setState({
            activeService: SERVICE,
            selectedConversations: { [SERVICE]: { path: ROOM, name: '金村 美玖', isGroupChat: false } },
        });
        server.use(
            http.get('/api/content/groups', () => HttpResponse.json({ groups: [], last_sync: {} })),
            http.get('/api/content/messages_by_path', () => HttpResponse.json({
                member: { id: '58', name: '金村 美玖', path: ROOM, thumbnail_local: null, thumbnail: null, portrait: null, phone_image: null },
                messages: [], total_count: 0, max_message_id: 0,
            })),
            http.post('/api/ui-state', () => new HttpResponse(null, { status: 204 })),
            http.get('/api/chat/letters_local', () => HttpResponse.json({ letters: [] })),
            http.get('/api/chat/message_dates/*', () => HttpResponse.json({ dates: [] })),
            http.get('/api/account/profile', () => HttpResponse.json({ name: 'me', avatars: [] })),
            http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: {} })),
            http.get('/api/chat/streak/:id', () => HttpResponse.json({ status: 'unavailable' })),
        );
    });
    afterEach(() => { resetDialogStack(); vi.unstubAllGlobals(); });

    async function openSidebar() {
        const user = userEvent.setup();
        render(<MessagesFeature appSettings={null} syncVersion={0} />);
        await user.click(toggle());
        expect(sidebar()).not.toHaveAttribute('inert');
        return user;
    }

    it('moves focus into the sidebar when it opens', async () => {
        await openSidebar();
        expect(sidebar().contains(document.activeElement)).toBe(true);
    });

    it('Escape closes it, returns focus to the toggle and leaves a breadcrumb', async () => {
        await openSidebar();
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        await waitFor(() => expect(sidebar()).toHaveAttribute('inert'));
        expect(toggle()).toHaveFocus();
        expect(clientLog).toHaveBeenCalledWith('dialog', { surface: 'sidebar', phase: 'close', reason: 'escape' });
    });

    it('ignores Escape typed in an IME and while a dialog is open', async () => {
        await openSidebar();
        fireEvent.keyDown(document.body, { key: 'Escape', isComposing: true });
        fireEvent.keyDown(document.body, { key: 'Escape', keyCode: 229 });
        let entry!: ReturnType<typeof pushDialog>;
        act(() => { entry = pushDialog({ node: () => null, dismissible: true }); });
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(sidebar()).not.toHaveAttribute('inert');
        act(() => popDialog(entry));
    });

    it('selecting the current conversation closes it too', async () => {
        const user = await openSidebar();
        await user.click(screen.getByRole('button', { name: 'current room' }));
        await waitFor(() => expect(sidebar()).toHaveAttribute('inert'));
        expect(toggle()).toHaveFocus();
    });

    it('selecting another conversation closes it', async () => {
        const user = await openSidebar();
        await user.click(screen.getByRole('button', { name: 'other room' }));
        await waitFor(() => expect(sidebar()).toHaveAttribute('inert'));
    });
});
