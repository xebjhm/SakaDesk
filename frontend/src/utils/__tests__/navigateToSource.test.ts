import { describe, it, expect, vi, beforeEach } from 'vitest';
import { navigateToSource } from '../navigateToSource';
import { useAppStore } from '../../store/appStore';

vi.mock('../../store/appStore', () => ({
    useAppStore: { getState: vi.fn() },
}));

/** Build a fresh set of store action mocks for one test. */
function buildStoreState(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        setActiveService: vi.fn(),
        setActiveFeature: vi.fn(),
        setSelectedConversation: vi.fn(),
        triggerConversationNavigation: vi.fn(),
        setTargetMessageId: vi.fn(),
        setTargetBlog: vi.fn(),
        activeService: null as string | null,
        selectedServices: [] as string[],
        setSelectedServices: vi.fn(),
        ...overrides,
    };
}

describe('navigateToSource', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('message references', () => {
        it('sets the target message id and navigates to the messages feature', () => {
            const state = buildStoreState({ selectedServices: ['hinatazaka46'] });
            vi.mocked(useAppStore.getState).mockReturnValue(state as unknown as ReturnType<typeof useAppStore.getState>);

            navigateToSource({
                type: 'message',
                service: 'hinatazaka46',
                groupId: 1,
                groupName: 'Group Chat',
                memberId: 42,
                memberName: 'Saito_Kyoko',
                messageId: 999,
                isGroupChat: false,
            });

            expect(state.setTargetMessageId).toHaveBeenCalledWith(999);
            expect(state.setActiveFeature).toHaveBeenCalledWith('hinatazaka46', 'messages');
            expect(state.setSelectedConversation).toHaveBeenCalledWith(
                'hinatazaka46',
                expect.objectContaining({
                    name: 'Saito Kyoko',
                    isGroupChat: false,
                }),
            );
        });

        it('adds the service to selectedServices when missing', () => {
            const state = buildStoreState({ selectedServices: [] });
            vi.mocked(useAppStore.getState).mockReturnValue(state as unknown as ReturnType<typeof useAppStore.getState>);

            navigateToSource({
                type: 'message',
                service: 'nogizaka46',
                groupId: 2,
                groupName: 'Group',
                memberId: 1,
                memberName: 'Member_One',
                messageId: 1,
                isGroupChat: true,
            });

            expect(state.setSelectedServices).toHaveBeenCalledWith(['nogizaka46']);
        });

        it('switches active service and does not re-trigger navigation when the service changes', () => {
            const state = buildStoreState({ activeService: 'nogizaka46', selectedServices: ['hinatazaka46', 'nogizaka46'] });
            vi.mocked(useAppStore.getState).mockReturnValue(state as unknown as ReturnType<typeof useAppStore.getState>);

            navigateToSource({
                type: 'message',
                service: 'hinatazaka46',
                groupId: 1,
                groupName: 'Group',
                memberId: 1,
                memberName: 'Member_One',
                messageId: 1,
                isGroupChat: false,
            });

            expect(state.setActiveService).toHaveBeenCalledWith('hinatazaka46');
            expect(state.triggerConversationNavigation).not.toHaveBeenCalled();
        });

        it('triggers conversation navigation when already on the target service', () => {
            const state = buildStoreState({ activeService: 'hinatazaka46', selectedServices: ['hinatazaka46'] });
            vi.mocked(useAppStore.getState).mockReturnValue(state as unknown as ReturnType<typeof useAppStore.getState>);

            navigateToSource({
                type: 'message',
                service: 'hinatazaka46',
                groupId: 1,
                groupName: 'Group',
                memberId: 1,
                memberName: 'Member_One',
                messageId: 1,
                isGroupChat: false,
            });

            expect(state.setActiveService).not.toHaveBeenCalled();
            expect(state.triggerConversationNavigation).toHaveBeenCalled();
        });
    });

    describe('blog references', () => {
        it('sets the target blog and navigates to the blogs feature', () => {
            const state = buildStoreState({ selectedServices: ['hinatazaka46'] });
            vi.mocked(useAppStore.getState).mockReturnValue(state as unknown as ReturnType<typeof useAppStore.getState>);

            navigateToSource({
                type: 'blog',
                service: 'hinatazaka46',
                blogId: 'blog-123',
                memberId: 42,
            });

            expect(state.setTargetBlog).toHaveBeenCalledWith(
                expect.objectContaining({
                    blogId: 'blog-123',
                    service: 'hinatazaka46',
                    memberId: 42,
                }),
            );
            expect(state.setActiveFeature).toHaveBeenCalledWith('hinatazaka46', 'blogs');
            expect(state.setTargetMessageId).not.toHaveBeenCalled();
        });

        it('does not switch active service when already active', () => {
            const state = buildStoreState({ activeService: 'hinatazaka46', selectedServices: ['hinatazaka46'] });
            vi.mocked(useAppStore.getState).mockReturnValue(state as unknown as ReturnType<typeof useAppStore.getState>);

            navigateToSource({
                type: 'blog',
                service: 'hinatazaka46',
                blogId: 'blog-123',
                memberId: 42,
            });

            expect(state.setActiveService).not.toHaveBeenCalled();
        });
    });
});
