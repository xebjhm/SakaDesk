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
})
