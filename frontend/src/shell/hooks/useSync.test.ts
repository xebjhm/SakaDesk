import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useSync } from './useSync'

// Mock appStore
const { mockRemoveInitialSyncService } = vi.hoisted(() => ({
    mockRemoveInitialSyncService: vi.fn(),
}))
vi.mock('../../store/appStore', () => {
    const mockUseAppStore = Object.assign(
        () => ({ activeService: 'hinatazaka46' }),
        { getState: () => ({ removeInitialSyncService: mockRemoveInitialSyncService }) },
    )
    return { useAppStore: mockUseAppStore }
})

describe('useSync', () => {
    const defaultOptions = {
        isAuthenticated: true,
        appSettings: {
            output_dir: '/test/output',
            auto_sync_enabled: false,
            sync_interval_minutes: 30,
            is_configured: true,
        },
        connectedServices: ['hinatazaka46'],
        setAuthError: vi.fn(),
        setIsAuthenticated: vi.fn(),
        onSyncComplete: vi.fn(),
        markServiceDisconnected: vi.fn(),
    }

    beforeEach(() => {
        vi.clearAllMocks()
        vi.stubGlobal('fetch', vi.fn())
    })

    it('should initialize with idle sync state', () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ is_fresh: false }),
        }))

        const { result } = renderHook(() => useSync(defaultOptions))

        expect(result.current.syncProgress.state).toBe('idle')
        expect(result.current.showSyncModal).toBe(false)
        expect(result.current.syncVersion).toBe(0)
        expect(result.current.sessionExpiredService).toBeNull()
    })

    it('should track sync progress by service', () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ is_fresh: false }),
        }))

        const { result } = renderHook(() => useSync(defaultOptions))

        expect(result.current.syncProgressByService).toEqual({})
    })

    it('should provide clearSessionExpired callback', () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ is_fresh: false }),
        }))

        const { result } = renderHook(() => useSync(defaultOptions))

        expect(typeof result.current.clearSessionExpired).toBe('function')
    })

    it('should provide startSync callback', () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ is_fresh: false }),
        }))

        const { result } = renderHook(() => useSync(defaultOptions))

        expect(typeof result.current.startSync).toBe('function')
    })

    it('should provide startSyncAllServices callback', () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ is_fresh: false }),
        }))

        const { result } = renderHook(() => useSync(defaultOptions))

        expect(typeof result.current.startSyncAllServices).toBe('function')
    })

    it('should allow toggling sync modal', () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ is_fresh: false }),
        }))

        const { result } = renderHook(() => useSync(defaultOptions))

        expect(result.current.showSyncModal).toBe(false)

        act(() => {
            result.current.setShowSyncModal(true)
        })

        expect(result.current.showSyncModal).toBe(true)
    })

    it('should start sync when authenticated with app settings', async () => {
        // Mock fresh check and sync start
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ is_fresh: false }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ status: 'started', service: 'hinatazaka46' }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ state: 'complete', total: 100, completed: 100 }),
            })
        )

        renderHook(() => useSync(defaultOptions))

        // Hook should trigger sync on mount when authenticated
        await waitFor(() => {
            expect(fetch).toHaveBeenCalled()
        })
    })

    it('should not start sync when not authenticated', () => {
        vi.stubGlobal('fetch', vi.fn())

        const options = {
            ...defaultOptions,
            isAuthenticated: false,
        }

        renderHook(() => useSync(options))

        // fetch should only be called for fresh check, not sync
        expect(fetch).not.toHaveBeenCalled()
    })

    it('should not start sync without app settings', () => {
        vi.stubGlobal('fetch', vi.fn())

        const options = {
            ...defaultOptions,
            appSettings: null,
        }

        renderHook(() => useSync(options))

        // Sync should not start without settings
        expect(fetch).not.toHaveBeenCalled()
    })

    it('should update sync state when startSync is called', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ is_fresh: false }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ status: 'started' }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ state: 'running', phase: 'messages', completed: 50, total: 100 }),
            })
        )

        const { result } = renderHook(() => useSync(defaultOptions))

        // Wait for initial load
        await waitFor(() => {
            expect(result.current.syncProgress).toBeDefined()
        })

        // Trigger a manual sync
        await act(async () => {
            await result.current.startSync(false, 'hinatazaka46')
        })

        // Should update progress state
        expect(result.current.syncProgress.state).not.toBe('error')
    })

    // SD-CONTRACT-11: an invalid-service 400 must surface as an error, not be
    // mistaken for "already running" and sent into a progress poll.
    // URL-aware mock so the mount auto-sync effect doesn't consume ordered mocks.
    it('marks an invalid-service 400 as an error instead of polling', async () => {
        vi.stubGlobal('fetch', vi.fn((url: string) => {
            if (url.includes('/api/sync/start') && url.includes('service=bogus')) {
                return Promise.resolve({
                    ok: false, status: 400,
                    json: () => Promise.resolve({ detail: 'Invalid service: bogus' }),
                })
            }
            if (url.includes('/api/sync/progress')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ state: 'complete', total: 1, completed: 1 }) })
            }
            // fresh check + any other start/verify
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ is_fresh: false, status: 'started' }) })
        }))

        const { result } = renderHook(() => useSync(defaultOptions))
        await waitFor(() => expect(result.current.syncProgress).toBeDefined())

        await act(async () => {
            await result.current.startSync(false, 'bogus')
        })

        expect(result.current.syncProgressByService['bogus']?.state).toBe('error')
        expect(result.current.syncProgressByService['bogus']?.detail).toContain('Invalid service')
    })

    it('treats a genuine "already running" 400 as a poll, not an error', async () => {
        vi.stubGlobal('fetch', vi.fn((url: string) => {
            if (url.includes('/api/sync/start') && url.includes('service=sakurazaka46')) {
                return Promise.resolve({
                    ok: false, status: 400,
                    json: () => Promise.resolve({ detail: 'Sync already running for sakurazaka46' }),
                })
            }
            if (url.includes('/api/sync/progress')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ state: 'running', phase: 'messages', completed: 1, total: 10 }) })
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ is_fresh: false, status: 'started' }) })
        }))

        const { result } = renderHook(() => useSync(defaultOptions))
        await waitFor(() => expect(result.current.syncProgress).toBeDefined())

        await act(async () => {
            await result.current.startSync(false, 'sakurazaka46')
        })

        // Not an error — it polled the existing run rather than reporting failure.
        expect(result.current.syncProgressByService['sakurazaka46']?.state).not.toBe('error')
    })

    it('should provide verifyAndFix callback', () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ is_fresh: false }),
        }))

        const { result } = renderHook(() => useSync(defaultOptions))

        expect(typeof result.current.verifyAndFix).toBe('function')
    })

    it('should POST to the verify endpoint and open the sync modal when verifyAndFix is called', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ is_fresh: false }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ status: 'started' }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ state: 'complete', total: 100, completed: 100 }),
            })
        )

        const { result } = renderHook(() => useSync(defaultOptions))

        await waitFor(() => {
            expect(result.current.syncProgress).toBeDefined()
        })

        await act(async () => {
            await result.current.verifyAndFix('hinatazaka46')
        })

        expect(fetch).toHaveBeenCalledWith(
            '/api/sync/verify?service=hinatazaka46',
            { method: 'POST' },
        )
        expect(result.current.showSyncModal).toBe(true)
    })
})
