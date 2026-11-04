import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useSync } from './useSync'
import { clientLog } from '../../utils/clientLog'

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }))

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

    // C2: the backend AutoSyncScheduler owns periodic syncs; the frontend only
    // does the one-time startup sync and never schedules timers of its own.
    describe('no frontend auto-sync timers', () => {
        beforeEach(() => { vi.useFakeTimers() })
        afterEach(() => { vi.useRealTimers() })

        it.each([false, true])('does not start syncs on a timer (adaptive=%s)', async (adaptive) => {
            const fetchMock = vi.fn((url: string) => {
                if (url.includes('/api/sync/start')) {
                    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'started' }) })
                }
                if (url.includes('/api/sync/progress')) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({ state: 'idle' }) })
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ is_fresh: false, interval_minutes: 1 }) })
            })
            vi.stubGlobal('fetch', fetchMock)

            renderHook(() => useSync({
                ...defaultOptions,
                appSettings: {
                    ...defaultOptions.appSettings,
                    auto_sync_enabled: true,
                    adaptive_sync_enabled: adaptive,
                    sync_interval_minutes: 1,
                },
            }))
            await act(async () => { await vi.advanceTimersByTimeAsync(0) })
            const startCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/sync/start')).length
            const afterStartup = startCalls()
            expect(afterStartup).toBe(1)
            expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/sync/next_interval'))).toBe(false)

            await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000) })
            expect(startCalls()).toBe(afterStartup)
        })
    })

    it('exposes isPolling and followSync for the backend sync watcher', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ is_fresh: false, state: 'idle' }),
        }))
        const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))
        expect(result.current.isPolling('hinatazaka46')).toBe(false)
        await act(async () => { result.current.followSync('hinatazaka46') })
        await waitFor(() => expect(result.current.syncProgressByService['hinatazaka46']?.state).toBe('idle'))
        expect(result.current.isPolling('hinatazaka46')).toBe(false)
    })

    describe('followSync on a backend sync that already finished', () => {
        const progressFetch = (body: Record<string, unknown>) =>
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ is_fresh: false, ...body }),
            }))

        it('surfaces session expiry: modal, disconnected marking, no leftover poller', async () => {
            progressFetch({ state: 'error', run_id: 5, error_code: 'session_expired', detail: 'SESSION_EXPIRED' })
            const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))
            await act(async () => { result.current.followSync('hinatazaka46') })
            await waitFor(() => expect(result.current.sessionExpiredService).toBe('hinatazaka46'))
            expect(defaultOptions.markServiceDisconnected).toHaveBeenCalledWith('hinatazaka46', 'Session expired')
            expect(result.current.isPolling('hinatazaka46')).toBe(false)
            expect(result.current.showSyncModal).toBe(false)
        })

        it('refreshes messages once for a run that completed unseen', async () => {
            progressFetch({ state: 'complete', run_id: 5 })
            const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))
            const before = result.current.syncVersion
            await act(async () => { result.current.followSync('hinatazaka46') })
            await waitFor(() => expect(result.current.syncVersion).toBe(before + 1))
            expect(result.current.isPolling('hinatazaka46')).toBe(false)
            expect(defaultOptions.markServiceDisconnected).not.toHaveBeenCalled()
        })
    })

    it('records the run_id of every handled progress response per service', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ is_fresh: false, state: 'complete', run_id: 9 }),
        }))
        const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))
        expect(result.current.lastHandledRunId('hinatazaka46')).toBeUndefined()
        await act(async () => { result.current.followSync('hinatazaka46') })
        await waitFor(() => expect(result.current.lastHandledRunId('hinatazaka46')).toBe(9))
        expect(result.current.lastHandledRunId('sakurazaka46')).toBeUndefined()
    })

    describe('startSync racing the backend sync watcher', () => {
        afterEach(() => { vi.useRealTimers() })

        function stubStartAndProgress() {
            let resolvePost: (r: unknown) => void = () => {}
            const progress = { state: 'running' as string }
            vi.stubGlobal('fetch', vi.fn((url: string) => {
                if (String(url).includes('/api/sync/start')) {
                    return new Promise(resolve => { resolvePost = resolve })
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...progress }) })
            }))
            return { progress, resolvePost: (r: unknown) => resolvePost(r) }
        }

        it('reports isPolling true while the start POST is in flight', async () => {
            const { resolvePost } = stubStartAndProgress()
            const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))
            expect(result.current.isPolling('hinatazaka46')).toBe(false)

            let pending: Promise<void> = Promise.resolve()
            act(() => { pending = result.current.startSync(true, 'hinatazaka46') })
            expect(result.current.isPolling('hinatazaka46')).toBe(true)

            await act(async () => {
                resolvePost({ ok: false, status: 500, json: () => Promise.resolve({ detail: 'boom' }) })
                await pending
            })
            expect(result.current.isPolling('hinatazaka46')).toBe(false)
        })

        it('closes the blocking modal when a follow lands before the start POST resolves', async () => {
            vi.useFakeTimers()
            const { progress, resolvePost } = stubStartAndProgress()
            const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))

            let pending: Promise<void> = Promise.resolve()
            act(() => { pending = result.current.startSync(true, 'hinatazaka46') })
            expect(result.current.showSyncModal).toBe(true)

            // Watcher-style follow (non-blocking) attaches the poller first.
            await act(async () => { result.current.followSync('hinatazaka46') })
            expect(result.current.syncProgressByService['hinatazaka46']?.state).toBe('running')

            // POST resolves afterwards: its blocking poll request must upgrade the live poller.
            await act(async () => {
                resolvePost({ ok: true, json: () => Promise.resolve({ status: 'started' }) })
                await pending
            })
            expect(result.current.showSyncModal).toBe(true)

            progress.state = 'idle'
            await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
            expect(result.current.syncProgressByService['hinatazaka46']?.state).toBe('idle')
            expect(result.current.showSyncModal).toBe(false)
            expect(result.current.isPolling('hinatazaka46')).toBe(false)
        })

        it('starts the same service once when two starts overlap', async () => {
            const { resolvePost } = stubStartAndProgress()
            const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))

            let first: Promise<void> = Promise.resolve()
            let second: Promise<void> = Promise.resolve()
            act(() => { first = result.current.startSync(false, 'hinatazaka46') })
            act(() => { second = result.current.startSync(true, 'hinatazaka46') })
            // The skipped blocking start still asks for the modal.
            expect(result.current.showSyncModal).toBe(true)
            expect(clientLog).toHaveBeenCalledWith('sync_start_skipped', { reason: 'starting' })

            await act(async () => {
                resolvePost({ ok: false, status: 500, json: () => Promise.resolve({ detail: 'boom' }) })
                await Promise.all([first, second])
            })
            const posts = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/api/sync/start'))
            expect(posts).toHaveLength(1)
        })
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
