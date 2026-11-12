import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { openChat } from '../../../shell/openChat';
import { clientLog } from '../../../utils/clientLog';
import { jumpToChat } from './jumpToChat';
import { memoryMessage } from '../__fixtures__/memories';

describe('jumpToChat', () => {
    it('opens her chat at the message and logs the jump without the path', () => {
        const msg = memoryMessage({ id: 4242 });
        jumpToChat(msg, '金村 美玖', 'album');
        expect(openChat).toHaveBeenCalledWith({
            service: 'hinatazaka46',
            path: msg.member_path,
            name: '金村 美玖',
            is_group_chat: false,
            message_id: 4242,
        });
        expect(clientLog).toHaveBeenCalledWith('memories_jump', { target: 'album', has_target: true });
        const logged = JSON.stringify(vi.mocked(clientLog).mock.calls);
        expect(logged).not.toContain('messages/');
        expect(logged).not.toContain('金村');
    });
});
