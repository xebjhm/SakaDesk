import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './appStore'

describe('appStore', () => {
    // Reset store state before each test
    beforeEach(() => {
        useAppStore.setState({
            selectedServices: [],
            activeService: null,
            activeFeatures: {},
            blogViewResetCounter: 0,
            featureOrders: {},
            favorites: {},
            blogSelectionModes: {},
            selectedConversations: {},
        })
    })

    describe('selectedServices', () => {
        it('should start with empty selected services', () => {
            const state = useAppStore.getState()
            expect(state.selectedServices).toEqual([])
        })

        it('should add a service', () => {
            const { addSelectedService } = useAppStore.getState()
            addSelectedService('hinatazaka46')
            expect(useAppStore.getState().selectedServices).toEqual(['hinatazaka46'])
        })

        it('should not add duplicate services', () => {
            const { addSelectedService } = useAppStore.getState()
            addSelectedService('hinatazaka46')
            addSelectedService('hinatazaka46')
            expect(useAppStore.getState().selectedServices).toEqual(['hinatazaka46'])
        })

        it('should remove a service', () => {
            const { addSelectedService, removeSelectedService } = useAppStore.getState()
            addSelectedService('hinatazaka46')
            addSelectedService('sakurazaka46')
            removeSelectedService('hinatazaka46')
            expect(useAppStore.getState().selectedServices).toEqual(['sakurazaka46'])
        })

        it('should switch active service when removing the active one', () => {
            useAppStore.setState({
                selectedServices: ['hinatazaka46', 'sakurazaka46'],
                activeService: 'hinatazaka46',
            })
            const { removeSelectedService } = useAppStore.getState()
            removeSelectedService('hinatazaka46')
            const state = useAppStore.getState()
            expect(state.activeService).toBe('sakurazaka46')
        })

        it('should set active to null when removing the last service', () => {
            useAppStore.setState({
                selectedServices: ['hinatazaka46'],
                activeService: 'hinatazaka46',
            })
            const { removeSelectedService } = useAppStore.getState()
            removeSelectedService('hinatazaka46')
            const state = useAppStore.getState()
            expect(state.activeService).toBeNull()
        })

        it('should replace all selected services', () => {
            const { setSelectedServices } = useAppStore.getState()
            setSelectedServices(['nogizaka46', 'sakurazaka46'])
            expect(useAppStore.getState().selectedServices).toEqual(['nogizaka46', 'sakurazaka46'])
        })
    })

    describe('activeService', () => {
        it('should start with null active service', () => {
            expect(useAppStore.getState().activeService).toBeNull()
        })

        it('should set active service', () => {
            const { setActiveService } = useAppStore.getState()
            setActiveService('hinatazaka46')
            expect(useAppStore.getState().activeService).toBe('hinatazaka46')
        })
    })

    describe('activeFeatures', () => {
        it('should default to messages feature', () => {
            const { getActiveFeature } = useAppStore.getState()
            expect(getActiveFeature('hinatazaka46')).toBe('messages')
        })

        it('should set and get active feature per service', () => {
            const { setActiveFeature, getActiveFeature } = useAppStore.getState()
            setActiveFeature('hinatazaka46', 'blogs')
            setActiveFeature('sakurazaka46', 'news')
            expect(getActiveFeature('hinatazaka46')).toBe('blogs')
            expect(getActiveFeature('sakurazaka46')).toBe('news')
        })
    })

    describe('blogViewResetCounter', () => {
        it('should start at 0', () => {
            expect(useAppStore.getState().blogViewResetCounter).toBe(0)
        })

        it('should increment on trigger', () => {
            const { triggerBlogViewReset } = useAppStore.getState()
            triggerBlogViewReset()
            expect(useAppStore.getState().blogViewResetCounter).toBe(1)
            triggerBlogViewReset()
            expect(useAppStore.getState().blogViewResetCounter).toBe(2)
        })
    })

    describe('featureOrders', () => {
        it('should return default order when not set', () => {
            const { getFeatureOrder } = useAppStore.getState()
            expect(getFeatureOrder('hinatazaka46')).toEqual(['messages', 'blogs', 'news', 'fanclub', 'ai'])
        })

        it('should set and get custom feature order', () => {
            const { setFeatureOrder, getFeatureOrder } = useAppStore.getState()
            const customOrder = ['blogs', 'messages', 'news', 'fanclub', 'ai'] as const
            setFeatureOrder('hinatazaka46', [...customOrder])
            expect(getFeatureOrder('hinatazaka46')).toEqual(customOrder)
        })

        it('should maintain independent orders per service', () => {
            const { setFeatureOrder, getFeatureOrder } = useAppStore.getState()
            setFeatureOrder('hinatazaka46', ['blogs', 'messages', 'news', 'fanclub', 'ai'])
            expect(getFeatureOrder('sakurazaka46')).toEqual(['messages', 'blogs', 'news', 'fanclub', 'ai'])
        })
    })

    describe('favorites', () => {
        it('should start with empty favorites', () => {
            const { getFavorites } = useAppStore.getState()
            expect(getFavorites('hinatazaka46')).toEqual([])
        })

        it('should add a favorite', () => {
            const { toggleFavorite, getFavorites, isFavorite } = useAppStore.getState()
            toggleFavorite('hinatazaka46', 'member1')
            expect(getFavorites('hinatazaka46')).toEqual(['member1'])
            expect(isFavorite('hinatazaka46', 'member1')).toBe(true)
        })

        it('should remove a favorite when toggled again', () => {
            const { toggleFavorite, getFavorites, isFavorite } = useAppStore.getState()
            toggleFavorite('hinatazaka46', 'member1')
            toggleFavorite('hinatazaka46', 'member1')
            expect(getFavorites('hinatazaka46')).toEqual([])
            expect(isFavorite('hinatazaka46', 'member1')).toBe(false)
        })

        it('should maintain independent favorites per service', () => {
            const { toggleFavorite, getFavorites } = useAppStore.getState()
            toggleFavorite('hinatazaka46', 'member1')
            toggleFavorite('sakurazaka46', 'member2')
            expect(getFavorites('hinatazaka46')).toEqual(['member1'])
            expect(getFavorites('sakurazaka46')).toEqual(['member2'])
        })
    })

    describe('blogSelectionModes', () => {
        it('should default to all mode', () => {
            const { getBlogSelectionMode } = useAppStore.getState()
            expect(getBlogSelectionMode('hinatazaka46')).toBe('all')
        })

        it('should set and get blog selection mode', () => {
            const { setBlogSelectionMode, getBlogSelectionMode } = useAppStore.getState()
            setBlogSelectionMode('hinatazaka46', 'favorite')
            expect(getBlogSelectionMode('hinatazaka46')).toBe('favorite')
        })

        it('should maintain independent modes per service', () => {
            const { setBlogSelectionMode, getBlogSelectionMode } = useAppStore.getState()
            setBlogSelectionMode('hinatazaka46', 'favorite')
            expect(getBlogSelectionMode('sakurazaka46')).toBe('all')
        })
    })

    describe('selectedConversations', () => {
        it('should default to null', () => {
            const { getSelectedConversation } = useAppStore.getState()
            expect(getSelectedConversation('hinatazaka46')).toBeNull()
        })

        it('should set and get selected conversation', () => {
            const { setSelectedConversation, getSelectedConversation } = useAppStore.getState()
            const conversation = { path: '/chat/1', name: 'Test Chat', isGroupChat: false }
            setSelectedConversation('hinatazaka46', conversation)
            expect(getSelectedConversation('hinatazaka46')).toEqual(conversation)
        })

        it('should clear selected conversation', () => {
            const { setSelectedConversation, getSelectedConversation } = useAppStore.getState()
            setSelectedConversation('hinatazaka46', { path: '/chat/1', name: 'Test', isGroupChat: false })
            setSelectedConversation('hinatazaka46', null)
            expect(getSelectedConversation('hinatazaka46')).toBeNull()
        })

        it('should maintain independent conversations per service', () => {
            const { setSelectedConversation, getSelectedConversation } = useAppStore.getState()
            const conv1 = { path: '/chat/1', name: 'Chat 1', isGroupChat: false }
            const conv2 = { path: '/chat/2', name: 'Chat 2', isGroupChat: true }
            setSelectedConversation('hinatazaka46', conv1)
            setSelectedConversation('sakurazaka46', conv2)
            expect(getSelectedConversation('hinatazaka46')).toEqual(conv1)
            expect(getSelectedConversation('sakurazaka46')).toEqual(conv2)
        })
    })

    describe('aiThreadsByService (Product-wave Task 6)', () => {
        beforeEach(() => {
            useAppStore.setState({ aiThreadsByService: {}, aiIsAsking: {}, aiAbortControllers: {} })
        })

        it('should default to an empty thread', () => {
            expect(useAppStore.getState().getAiThread('hinatazaka46')).toEqual([])
        })

        it('should append turns to a service thread', () => {
            const { appendAiTurns, getAiThread } = useAppStore.getState()
            appendAiTurns('hinatazaka46', [
                { id: 't1', role: 'user', text: 'question', createdAt: 1 },
            ])
            expect(getAiThread('hinatazaka46')).toEqual([
                { id: 't1', role: 'user', text: 'question', createdAt: 1 },
            ])
        })

        it('should replace a turn by id, leaving others untouched', () => {
            const { appendAiTurns, replaceAiTurn, getAiThread } = useAppStore.getState()
            appendAiTurns('hinatazaka46', [
                { id: 't1', role: 'user', text: 'q', createdAt: 1 },
                { id: 't2', role: 'assistant', state: 'streaming', progressLabel: 'Thinking…', createdAt: 1 },
            ])
            replaceAiTurn('hinatazaka46', 't2', () => ({
                id: 't2',
                role: 'assistant',
                state: 'noEvidence',
                createdAt: 1,
            }))
            const thread = getAiThread('hinatazaka46')
            expect(thread[0]).toEqual({ id: 't1', role: 'user', text: 'q', createdAt: 1 })
            expect(thread[1]).toEqual({ id: 't2', role: 'assistant', state: 'noEvidence', createdAt: 1 })
        })

        it('should keep independent threads per service', () => {
            const { appendAiTurns, getAiThread } = useAppStore.getState()
            appendAiTurns('hinatazaka46', [{ id: 'a', role: 'user', text: 'a', createdAt: 1 }])
            appendAiTurns('sakurazaka46', [{ id: 'b', role: 'user', text: 'b', createdAt: 1 }])
            expect(getAiThread('hinatazaka46')).toHaveLength(1)
            expect(getAiThread('sakurazaka46')).toHaveLength(1)
            expect(getAiThread('hinatazaka46')[0].id).toBe('a')
        })

        it('clearAiThread should empty only the targeted service thread', () => {
            const { appendAiTurns, clearAiThread, getAiThread } = useAppStore.getState()
            appendAiTurns('hinatazaka46', [{ id: 'a', role: 'user', text: 'a', createdAt: 1 }])
            appendAiTurns('sakurazaka46', [{ id: 'b', role: 'user', text: 'b', createdAt: 1 }])
            clearAiThread('hinatazaka46')
            expect(getAiThread('hinatazaka46')).toEqual([])
            expect(getAiThread('sakurazaka46')).toHaveLength(1)
        })

        it('a thread survives being read again after a simulated remount (state lives outside any component)', () => {
            // Regression test for the original bug: `AiFeature` used to hold
            // `threadsByService` in local `useState`, so unmounting/remounting
            // the component reset it to `{}`. Now it's store state -- reading
            // it "again" (simulating a fresh component mount) must see the
            // same data, with no unmount step required to prove it (the store
            // is a module singleton, independent of React's component tree).
            const { appendAiTurns } = useAppStore.getState()
            appendAiTurns('hinatazaka46', [
                { id: 't1', role: 'user', text: 'what did she eat', createdAt: 1 },
                { id: 't2', role: 'assistant', state: 'noEvidence', createdAt: 1 },
            ])
            // Fresh `getState()` call, as a newly mounted component would do.
            expect(useAppStore.getState().getAiThread('hinatazaka46')).toHaveLength(2)
        })
    })

    describe('aiIsAsking (Product-wave Task 6)', () => {
        beforeEach(() => {
            useAppStore.setState({ aiIsAsking: {} })
        })

        it('should default to false', () => {
            expect(useAppStore.getState().aiIsAsking['hinatazaka46']).toBeUndefined()
        })

        it('should set per-service asking state independently', () => {
            const { setAiIsAsking } = useAppStore.getState()
            setAiIsAsking('hinatazaka46', true)
            expect(useAppStore.getState().aiIsAsking['hinatazaka46']).toBe(true)
            expect(useAppStore.getState().aiIsAsking['sakurazaka46']).toBeUndefined()
        })
    })

    describe('aiAbortControllers (Product-wave Task 6)', () => {
        beforeEach(() => {
            useAppStore.setState({ aiAbortControllers: {} })
        })

        it('should store and clear a controller per service', () => {
            const { setAiAbortController } = useAppStore.getState()
            const controller = new AbortController()
            setAiAbortController('hinatazaka46', controller)
            expect(useAppStore.getState().aiAbortControllers['hinatazaka46']).toBe(controller)

            setAiAbortController('hinatazaka46', null)
            expect(useAppStore.getState().aiAbortControllers['hinatazaka46']).toBeUndefined()
        })
    })

    describe('settingsRequest / openSettings (expert review WIN 2)', () => {
        beforeEach(() => {
            useAppStore.setState({ settingsRequest: null })
        })

        it('should default to no pending request', () => {
            expect(useAppStore.getState().settingsRequest).toBeNull()
        })

        it('openSettings(tab) records the request and does nothing else', () => {
            const before = useAppStore.getState()
            useAppStore.getState().openSettings('ai')

            const after = useAppStore.getState()
            expect(after.settingsRequest).toEqual({ tab: 'ai' })
            // Side-effect-free beyond `settingsRequest` (the exported
            // contract): nothing else in the store changed.
            expect(after.activeService).toBe(before.activeService)
            expect(after.activeFeatures).toBe(before.activeFeatures)
            expect(after.selectedServices).toBe(before.selectedServices)
        })

        it('a later openSettings call replaces the pending tab', () => {
            useAppStore.getState().openSettings('general')
            useAppStore.getState().openSettings('updates')
            expect(useAppStore.getState().settingsRequest).toEqual({ tab: 'updates' })
        })

        it('clearSettingsRequest consumes the request', () => {
            useAppStore.getState().openSettings('sync')
            useAppStore.getState().clearSettingsRequest()
            expect(useAppStore.getState().settingsRequest).toBeNull()
        })
    })
})
