import { describe, it, expect, beforeEach, vi } from 'vitest'

// Observe the backend-synced prefs cache so we can assert what gets persisted.
const setPrefSpy = vi.fn()
let stored: Record<string, unknown> = {}

vi.mock('../core/persistence/persisted', () => ({
    persisted: {
        getPref: (key: string, fallback: unknown) => (key in stored ? stored[key] : fallback),
        setPref: (key: string, value: unknown) => {
            setPrefSpy(key, value)
            stored[key] = value
        },
    },
}))

const BUNDLE_KEY = 'sakadesk-app-state'

function storedBundle(state: Record<string, unknown>) {
    return JSON.stringify({ state, version: 4 })
}

// A fresh import gives a store whose hydration gate is still closed
// (hasHydratedFromBackend === false), i.e. the state right after app launch and
// before App.tsx calls rehydrate().
async function freshStore() {
    vi.resetModules()
    setPrefSpy.mockClear()
    const mod = await import('./appStore')
    return mod.useAppStore
}

describe('appStore persistence hydration gate (SD-FE-STATE-01)', () => {
    beforeEach(() => {
        stored = {}
    })

    it('does NOT persist store writes issued before rehydrate()', async () => {
        const store = await freshStore()
        // checkAuth-style pre-hydration write (the P0 trigger).
        store.getState().setActiveService('hinatazaka46')
        expect(setPrefSpy).not.toHaveBeenCalledWith(BUNDLE_KEY, expect.anything())
    })

    it('a pre-hydration write does NOT clobber the stored bundle; rehydrate restores it', async () => {
        stored = {
            [BUNDLE_KEY]: storedBundle({
                selectedServices: ['sakurazaka46'],
                activeService: 'sakurazaka46',
            }),
        }
        const store = await freshStore()

        store.getState().setActiveService('hinatazaka46') // pre-hydration
        expect(setPrefSpy).not.toHaveBeenCalledWith(BUNDLE_KEY, expect.anything())

        await store.persist.rehydrate()
        expect(store.getState().activeService).toBe('sakurazaka46')
        expect(store.getState().selectedServices).toEqual(['sakurazaka46'])
    })

    it('persists store writes AFTER rehydrate()', async () => {
        stored = {
            [BUNDLE_KEY]: storedBundle({
                selectedServices: ['sakurazaka46'],
                activeService: 'sakurazaka46',
            }),
        }
        const store = await freshStore()
        await store.persist.rehydrate()
        setPrefSpy.mockClear()

        store.getState().setActiveService('nogizaka46')
        expect(setPrefSpy).toHaveBeenCalledWith(BUNDLE_KEY, expect.any(String))
        const calls = setPrefSpy.mock.calls
        expect(calls[calls.length - 1]?.[1] as string).toContain('nogizaka46')
    })
})
