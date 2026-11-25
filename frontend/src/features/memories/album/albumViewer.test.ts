import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
import { openChat } from '../../../shell/openChat';
import { albumItemKey, albumViewerItems, viewerIndexOf } from './albumViewer';
import { isViewableMedia } from '../shared/mediaSrc';
import { photo } from './__fixtures__';

beforeEach(() => {
    vi.mocked(openChat).mockClear();
    vi.mocked(clientLog).mockClear();
});

const opts = (onBeforeJump = vi.fn()) => ({ nameOf: () => '金村 美玖', sourceLabel: 'View in chat', onBeforeJump });

describe('albumViewer', () => {
    it('keeps only pictures and videos with a file, oldest first', () => {
        const items = [
            photo(3, '2024-09', { ts: '2024-09-20T00:00:00Z' }),
            photo(1, '2024-09', { ts: '2024-09-01T00:00:00Z' }),
            photo(9, '2024-09', { type: 'voice' }),
            photo(8, '2024-09', { media_url: null, media_file: null }),
            photo(2, '2024-09', { ts: '2024-09-10T00:00:00Z', type: 'video', media_url: null }),
        ];
        const { viewable, items: viewer } = albumViewerItems(items, opts());
        expect(viewable.map((m) => m.id)).toEqual([1, 2, 3]);
        expect(viewer.map((v) => v.type)).toEqual(['picture', 'video', 'picture']);
        // a video without a URL is built from its service-relative file
        expect(viewer[1].src).toBe('/api/content/media/hinatazaka46/messages/34%20%E9%87%91%E6%9D%91%20%E7%BE%8E%E7%8E%96/58%20%E9%87%91%E6%9D%91%20%E7%BE%8E%E7%8E%96/picture/2.jpg');
        expect(viewer[0]).toMatchObject({ timestamp: '2024-09-01T00:00:00Z', sourceLabel: 'View in chat', messageId: 1, service: 'hinatazaka46' });
        expect(isViewableMedia(items[2])).toBe(false);
    });

    it('finds a message by room and id', () => {
        const a = photo(1, '2024-09');
        const b = photo(1, '2024-09', { room: 'messages/x/y', ts: '2024-09-15T00:00:00Z' });
        const { viewable } = albumViewerItems([a, b], opts());
        expect(viewerIndexOf(viewable, b)).toBe(1);
        expect(viewerIndexOf(viewable, photo(99, '2024-09'))).toBe(-1);
        expect(albumItemKey(a)).not.toBe(albumItemKey(b));
    });

    it('jumps to her chat from the source link and logs the album as the source', () => {
        const before = vi.fn();
        const { items } = albumViewerItems([photo(5, '2024-09')], opts(before));
        items[0].onSourceJump?.();
        expect(before).toHaveBeenCalled();
        expect(vi.mocked(openChat)).toHaveBeenCalledWith(expect.objectContaining({ message_id: 5, name: '金村 美玖', is_group_chat: false }));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_jump', { target: 'album', has_target: true });
    });
});
