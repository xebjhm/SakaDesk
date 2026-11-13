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
        vi.stubGlobal('fetch', vi.fn((url: string) => {
            const reply = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
            if (url.includes('/api/sync/progress')) return reply({ state: 'running', phase: 'messages', completed: 50, total: 100 })
            if (url.includes('/api/sync/queue')) return reply({ running: null, queued: [], sequence: null })
            if (url.includes('/api/sync/start')) return reply({ status: 'started', sequence_id: 's1' })
            return reply({ is_fresh: false })
        }))

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

    describe('progress polling', () => {
        const hanging = () => vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_res, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }))

        afterEach(() => { vi.useRealTimers() })

        it('reads progress uncached', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ state: 'complete', run_id: 3 }),
            })
            vi.stubGlobal('fetch', fetchMock)
            const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))
            await act(async () => { result.current.followSync('hinatazaka46') })
            await waitFor(() => expect(result.current.lastHandledRunId('hinatazaka46')).toBe(3))
            const call = fetchMock.mock.calls.find(c => String(c[0]).startsWith('/api/sync/progress'))
            expect(call?.[1]).toMatchObject({ cache: 'no-store' })
        })

        const completeBody = { ok: true, json: () => Promise.resolve({ state: 'complete', run_id: 5 }) }

        it('a timed-out read is retried and a later answer completes the follow normally', async () => {
            vi.useFakeTimers()
            const fetchMock = hanging()
            vi.stubGlobal('fetch', fetchMock)
            const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))
            await act(async () => { result.current.followSync('hinatazaka46') })
            await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
            expect(clientLog).toHaveBeenCalledWith('poll_timeout', { key: 'sync_progress_hinatazaka46', timeout_ms: 4000 })
            expect(clientLog).toHaveBeenCalledWith('poll_retry', { key: 'sync_progress_hinatazaka46', count: 1 })
            expect(result.current.isPolling('hinatazaka46')).toBe(true)
            fetchMock.mockResolvedValueOnce(completeBody as unknown as Response)
            await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
            expect(result.current.syncProgressByService.hinatazaka46?.state).toBe('complete')
            expect(result.current.lastHandledRunId('hinatazaka46')).toBe(5)
            expect(clientLog).not.toHaveBeenCalledWith('poll_gave_up', expect.anything())
        })

        it('a running sync survives more than MAX consecutive timeouts and then completes', async () => {
            vi.useFakeTimers()
            const running = { ok: true, json: () => Promise.resolve({ state: 'running', run_id: 6, phase: 'x', completed: 1, total: 5 }) }
            const fetchMock = vi.fn().mockResolvedValueOnce(running)
            vi.stubGlobal('fetch', fetchMock)
            const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))
            await act(async () => { result.current.followSync('hinatazaka46') })
            await act(async () => { await vi.advanceTimersByTimeAsync(0) })
            expect(result.current.syncProgressByService.hinatazaka46?.state).toBe('running')
            // Then the backend stops answering: 6 timed-out reads (> MAX_PROGRESS_RETRIES).
            fetchMock.mockImplementation(hanging().getMockImplementation()!)
            await act(async () => { await vi.advanceTimersByTimeAsync(1000 + 6 * 5000) })
            expect(clientLog).toHaveBeenCalledWith('poll_retry', { key: 'sync_progress_hinatazaka46', count: 3 })
            expect(clientLog).not.toHaveBeenCalledWith('poll_gave_up', expect.anything())
            expect(result.current.isPolling('hinatazaka46')).toBe(true)
            expect(result.current.syncProgressByService.hinatazaka46?.state).toBe('running')
            fetchMock.mockResolvedValue(completeBody as unknown as Response)
            await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
            expect(result.current.syncProgressByService.hinatazaka46?.state).toBe('complete')
            expect(result.current.isPolling('hinatazaka46')).toBe(false)
        })

        it('a non-running follow gives up after MAX retries and reports lost connection', async () => {
            vi.useFakeTimers()
            const fetchMock = hanging()
            vi.stubGlobal('fetch', fetchMock)
            const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))
            await act(async () => { result.current.followSync('hinatazaka46') })
            // 4 reads (1 + 3 retries), each 4 s timeout + 1 s spacing between.
            await act(async () => { await vi.advanceTimersByTimeAsync(4000 + 3 * 5000) })
            expect(fetchMock).toHaveBeenCalledTimes(4)
            expect(clientLog).toHaveBeenCalledWith('poll_retry', { key: 'sync_progress_hinatazaka46', count: 3 })
            expect(clientLog).toHaveBeenCalledWith('poll_gave_up', { key: 'sync_progress_hinatazaka46', count: 3 })
            expect(result.current.isPolling('hinatazaka46')).toBe(false)
            expect(result.current.syncProgressByService.hinatazaka46?.state).toBe('error')
            await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
            expect(fetchMock).toHaveBeenCalledTimes(4)
        })

        it('unmounting aborts the pending request: no timeout breadcrumb, no retry, no further fetch', async () => {
            vi.useFakeTimers()
            const fetchMock = hanging()
            vi.stubGlobal('fetch', fetchMock)
            const { result, unmount } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))
            await act(async () => { result.current.followSync('hinatazaka46') })
            const callsBefore = fetchMock.mock.calls.length
            unmount()
            await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
            expect(fetchMock).toHaveBeenCalledTimes(callsBefore)
            expect(clientLog).not.toHaveBeenCalledWith('poll_timeout', expect.anything())
            expect(clientLog).not.toHaveBeenCalledWith('poll_retry', expect.anything())
        })
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

        it('a skipped blocking start does not outlive a failed first start', async () => {
            const { progress, resolvePost } = stubStartAndProgress()
            const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))

            let first: Promise<void> = Promise.resolve()
            act(() => { first = result.current.startSync(false, 'hinatazaka46') })
            act(() => { void result.current.startSync(true, 'hinatazaka46') })
            expect(result.current.showSyncModal).toBe(true)

            await act(async () => {
                resolvePost({ ok: false, status: 500, json: () => Promise.resolve({ detail: 'boom' }) })
                await first
            })
            expect(result.current.syncProgressByService['hinatazaka46']?.state).toBe('error')

            // A later non-blocking follow must not act as the failed start's modal owner.
            progress.state = 'idle'
            await act(async () => { result.current.followSync('hinatazaka46') })
            await waitFor(() => expect(result.current.syncProgressByService['hinatazaka46']?.state).toBe('idle'))
            expect(result.current.showSyncModal).toBe(true)
        })

        it('keeps the start marked in flight while a refused start reads its answer', async () => {
            const { resolvePost } = stubStartAndProgress()
            const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))

            let first: Promise<void> = Promise.resolve()
            act(() => { first = result.current.startSync(false, 'hinatazaka46') })
            let readBody!: (v: unknown) => void
            await act(async () => {
                resolvePost({ ok: false, status: 500, json: () => new Promise(resolve => { readBody = resolve }) })
            })
            // The POST has answered but its body is still being read: a second start is skipped.
            expect(result.current.isPolling('hinatazaka46')).toBe(true)
            await act(async () => { await result.current.startSync(false, 'hinatazaka46') })
            const posts = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/api/sync/start'))
            expect(posts).toHaveLength(1)

            await act(async () => { readBody({ detail: 'boom' }); await first })
            expect(result.current.isPolling('hinatazaka46')).toBe(false)
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

    // S1 (spec 2026-11-10): the backend owns the sequence (start-all + GET /api/sync/queue);
    // the hook only displays it and never starts the services one by one itself.
    describe('sequential sync driven by the backend queue', () => {
        type Seq = {
            id: string; services: string[]; current_index: number; blocking: boolean;
            state: 'running' | 'complete' | 'cancelled'; completed: string[]; failed: string[];
        }
        function fakeBackend(services: string[], opts: { startAllStatus?: number; progress?: (svc: string) => unknown } = {}) {
            const seq: Seq = { id: 'seq1', services, current_index: 0, blocking: true, state: 'running', completed: [], failed: [] }
            const startAllBodies: unknown[] = []
            vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = String(input)
                const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
                if (url.includes('/api/sync/start-all')) {
                    startAllBodies.push(JSON.parse(String(init?.body)))
                    if (opts.startAllStatus) return reply({ detail: 'boom' }, opts.startAllStatus)
                    return reply({ sequence_id: seq.id, results: {} })
                }
                if (url.includes('/api/sync/queue')) return reply({ running: null, queued: [], sequence: { ...seq } })
                if (url.includes('/api/sync/cancel?sequence=')) {
                    seq.state = 'cancelled'
                    return reply({ status: 'cancelled', sequence: seq.id })
                }
                if (url.includes('/api/sync/progress')) {
                    const svc = new URL(url, 'http://x').searchParams.get('service') ?? ''
                    return reply(opts.progress?.(svc) ?? { state: 'running', phase: 'syncing', completed: 1, total: 4 })
                }
                return reply({})
            }))
            const advance = (outcome: 'complete' | 'failed') => {
                const svc = seq.services[seq.current_index]
                if (outcome === 'complete') seq.completed.push(svc)
                else seq.failed.push(svc)
                if (seq.current_index < seq.services.length - 1) seq.current_index += 1
                else seq.state = 'complete'
            }
            return { seq, startAllBodies, advance }
        }
        const urls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url))
        const unconfigured = { ...defaultOptions, appSettings: { ...defaultOptions.appSettings, is_configured: false } }

        it('posts one start-all and follows the backend order to its outcome', async () => {
            const backend = fakeBackend(['nogizaka46', 'sakurazaka46', 'hinatazaka46'])
            const { result } = renderHook(() => useSync(unconfigured))
            let pending: Promise<unknown> = Promise.resolve()
            act(() => { pending = result.current.startSequentialSync(['hinatazaka46', 'sakurazaka46', 'nogizaka46']) })

            await waitFor(() => expect(result.current.sequentialSyncInfo?.currentService).toBe('nogizaka46'))
            expect(result.current.sequentialSyncInfo?.services).toEqual(['nogizaka46', 'sakurazaka46', 'hinatazaka46'])
            expect(result.current.showSyncModal).toBe(true)
            expect(backend.startAllBodies).toEqual([{ services: ['hinatazaka46', 'sakurazaka46', 'nogizaka46'], blocking: true }])

            act(() => backend.advance('complete'))
            await waitFor(() => expect(result.current.sequentialSyncInfo?.currentIndex).toBe(1))
            act(() => backend.advance('failed'))
            await waitFor(() => expect(result.current.sequentialSyncInfo?.currentService).toBe('hinatazaka46'))
            act(() => backend.advance('failed'))

            let outcome: unknown
            await act(async () => { outcome = await pending })
            expect(outcome).toEqual({ completed: 1, failed: 2, cancelled: false })
            expect(clientLog).toHaveBeenCalledWith('sync_sequence', { outcome: 'partial', count: 1 })
            expect(result.current.sequentialSyncInfo).toBeNull()
            // Never the old per-service starts.
            expect(urls().some(u => u.includes('/api/sync/start?'))).toBe(false)
        })

        it('cancel ends the whole backend sequence and closes the dialog at once', async () => {
            const backend = fakeBackend(['nogizaka46', 'sakurazaka46', 'hinatazaka46'])
            const { result } = renderHook(() => useSync(unconfigured))
            let pending: Promise<unknown> = Promise.resolve()
            act(() => { pending = result.current.startSequentialSync(['sakurazaka46', 'hinatazaka46', 'nogizaka46']) })
            // 乃木坂46 completes; the user cancels while 櫻坂46 syncs.
            await waitFor(() => expect(result.current.sequentialSyncInfo?.currentService).toBe('nogizaka46'))
            act(() => backend.advance('complete'))
            await waitFor(() => expect(result.current.sequentialSyncInfo?.currentService).toBe('sakurazaka46'))
            await waitFor(() => expect(result.current.syncProgressByService['sakurazaka46']?.phase).toBe('syncing'))

            // The dialog's Cancel button calls cancelSync() with no service.
            let outcome: unknown
            await act(async () => {
                await result.current.cancelSync()
                outcome = await pending
            })
            // The counts come from the last queue read (the backend logs the same).
            expect(outcome).toEqual({ completed: 1, failed: 2, cancelled: true })
            expect(urls().filter(u => u.includes('/api/sync/cancel'))).toEqual(['/api/sync/cancel?sequence=seq1'])
            expect(result.current.syncProgressByService['sakurazaka46']?.state).toBe('error')
            expect(result.current.sequentialSyncInfo).toBeNull()
            expect(result.current.showSyncModal).toBe(false)
            expect(clientLog).toHaveBeenCalledWith('sync_sequence', { outcome: 'cancelled', count: 1 })
        })

        it('leaves out a service that is already polling, like the non-blocking start-all', async () => {
            const backend = fakeBackend(['sakurazaka46'])
            const { result } = renderHook(() => useSync(unconfigured))
            await act(async () => { result.current.followSync('hinatazaka46') })
            expect(result.current.isPolling('hinatazaka46')).toBe(true)

            let pending: Promise<unknown> = Promise.resolve()
            act(() => { pending = result.current.startSequentialSync(['hinatazaka46', 'sakurazaka46']) })
            await waitFor(() => expect(result.current.sequentialSyncInfo?.currentService).toBe('sakurazaka46'))
            expect(backend.startAllBodies).toEqual([{ services: ['sakurazaka46'], blocking: true }])
            expect(clientLog).toHaveBeenCalledWith('sync_start_skipped', { reason: 'starting', count: 1 })
            expect(result.current.isPolling('sakurazaka46')).toBe(true)

            act(() => backend.advance('complete'))
            await act(async () => { await pending })
            // The start guard is released once the sequence is over.
            expect(result.current.sequentialSyncInfo).toBeNull()
        })

        it('starts nothing when every service is already starting', async () => {
            const backend = fakeBackend(['hinatazaka46'])
            const { result } = renderHook(() => useSync(unconfigured))
            await act(async () => { result.current.followSync('hinatazaka46') })

            let outcome: unknown
            await act(async () => { outcome = await result.current.startSequentialSync(['hinatazaka46']) })
            expect(outcome).toEqual({ completed: 0, failed: 0, cancelled: false })
            expect(backend.startAllBodies).toEqual([])
            expect(clientLog).toHaveBeenCalledWith('sync_start_skipped', { reason: 'starting', count: 1 })
        })

        it('a refused start-all settles as all failed', async () => {
            fakeBackend(['yodel'], { startAllStatus: 503 })
            const { result } = renderHook(() => useSync(unconfigured))
            let outcome: unknown
            await act(async () => { outcome = await result.current.startSequentialSync(['yodel']) })
            expect(outcome).toEqual({ completed: 0, failed: 1, cancelled: false })
            expect(clientLog).toHaveBeenCalledWith('sync_start_all_failed', { reason: 'http_503' })
            expect(clientLog).toHaveBeenCalledWith('sync_sequence', { outcome: 'none', count: 0 })
        })

        it('a queued service keeps its poller alive and shows its place in line', async () => {
            fakeBackend(['nogizaka46', 'yodel'], {
                progress: (svc) => svc === 'yodel'
                    ? { state: 'queued', queue_position: 1 }
                    : { state: 'running', phase: 'syncing', completed: 1, total: 4 },
            })
            const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))
            await act(async () => { result.current.followSync('yodel') })
            await waitFor(() => expect(result.current.syncProgressByService['yodel']?.state).toBe('queued'))
            expect(result.current.syncProgressByService['yodel']?.queue_position).toBe(1)
            expect(result.current.isPolling('yodel')).toBe(true)
        })

        it('reopens the dialog on a blocking sequence that is still running (reload)', async () => {
            fakeBackend(['nogizaka46', 'hinatazaka46'])
            const { result } = renderHook(() => useSync({ ...defaultOptions, connectedServices: [] }))
            await waitFor(() => expect(result.current.showSyncModal).toBe(true))
            await waitFor(() => expect(result.current.sequentialSyncInfo?.currentService).toBe('nogizaka46'))
            expect(clientLog).toHaveBeenCalledWith('sync_sequence_resumed', { count: 2 })
        })

        it('the startup sync sends a single non-blocking start-all, not one start per service', async () => {
            const backend = fakeBackend(['nogizaka46', 'hinatazaka46'])
            vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: true, status: 200, json: async () => ({ running: null, queued: [], sequence: null }) }) as unknown as Response)
            renderHook(() => useSync({ ...defaultOptions, connectedServices: ['hinatazaka46', 'nogizaka46'] }))
            await waitFor(() => expect(backend.startAllBodies).toHaveLength(1))
            expect(backend.startAllBodies[0]).toEqual({ services: ['hinatazaka46', 'nogizaka46'], blocking: false })
            expect(urls().some(u => u.includes('/api/sync/start?'))).toBe(false)
        })
    })

    // --- release v0.4.2 review follow-ups ------------------------------------
    describe('review follow-ups', () => {
        const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
        const urls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url))
        const unconfigured = { ...defaultOptions, appSettings: { ...defaultOptions.appSettings, is_configured: false } }

        it('a verify queued behind a sync of the same service waits for its own result', async () => {
            const steps = [
                { state: 'running', phase: 'syncing', job_kind: 'sync', completed: 1, total: 4 },
                { state: 'complete', job_kind: 'sync', completed: 4, total: 4 },
                { state: 'running', phase: 'verifying', job_kind: 'verify', completed: 1, total: 2 },
                { state: 'complete', job_kind: 'verify', completed: 2, total: 2, result: { members: 1, checked: 3, missing: 0, repaired: 0, failed: 0, still_missing: 0 } },
            ]
            let i = 0
            vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
                const url = String(input)
                if (url.includes('/api/sync/verify')) return reply({ status: 'queued', position: 1 })
                if (url.includes('/api/sync/progress')) return reply(steps[Math.min(i++, steps.length - 1)])
                return reply({})
            }))
            const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))
            await act(async () => { await result.current.verifyAndFix('hinatazaka46') })
            await waitFor(() => expect(result.current.syncProgressByService['hinatazaka46']?.result).toBeTruthy(), { timeout: 8000 })
            // The sync's completion did not end it; the verify findings are shown.
            expect(result.current.syncProgressByService['hinatazaka46']?.state).toBe('complete')
            expect(result.current.showSyncModal).toBe(true)
        }, 15000)

        it('a sequence that disappears from the backend is reported as lost, not complete', async () => {
            let reads = 0
            vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
                const url = String(input)
                if (url.includes('/api/sync/start-all')) return reply({ sequence_id: 'seq1', results: {} })
                if (url.includes('/api/sync/queue')) {
                    reads += 1
                    return reply(reads === 1
                        ? { sequence: { id: 'seq1', services: ['yodel'], current_index: 0, blocking: true, state: 'running', completed: [], failed: [] } }
                        : { sequence: null })
                }
                return reply({ state: 'running', phase: 'syncing', completed: 0, total: 1 })
            }))
            const { result } = renderHook(() => useSync(unconfigured))
            let outcome: unknown
            await act(async () => { outcome = await result.current.startSequentialSync(['yodel']) })
            expect(outcome).toEqual({ completed: 0, failed: 1, cancelled: false, lost: true })
            expect(clientLog).toHaveBeenCalledWith('sync_sequence', { outcome: 'lost', count: 0 })
            expect(result.current.syncProgress.state).toBe('error')
        })

        it.each([
            [500, {}, 'http_500'],
            [200, { status: 'not_found' }, 'not_found'],
        ])('a cancel that did not take effect leaves a breadcrumb (%s)', async (status, body, reason) => {
            vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
                const url = String(input)
                if (url.includes('/api/sync/cancel')) return reply(body, status)
                return reply({ state: 'running', phase: 'syncing', completed: 1, total: 4 })
            }))
            const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))
            await act(async () => { await result.current.cancelSync('yodel') })
            expect(clientLog).toHaveBeenCalledWith('sync_cancel_failed', { target: 'service', reason })
        })

        it('a cancel pressed while the start-all is in flight cancels the sequence once it exists', async () => {
            let answer!: (r: unknown) => void
            vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
                const url = String(input)
                if (url.includes('/api/sync/start-all')) return new Promise(resolve => { answer = resolve })
                return Promise.resolve(reply({ status: 'cancelled' }))
            }))
            const { result } = renderHook(() => useSync(unconfigured))
            let pending: Promise<unknown> = Promise.resolve()
            act(() => { pending = result.current.startSequentialSync(['nogizaka46', 'yodel']) })
            await act(async () => { await result.current.cancelSync() })
            let outcome: unknown
            await act(async () => {
                answer(reply({ sequence_id: 'seq9', results: {} }))
                outcome = await pending
            })
            expect(outcome).toEqual({ completed: 0, failed: 2, cancelled: true })
            expect(urls().filter(u => u.includes('/api/sync/cancel'))).toEqual(['/api/sync/cancel?sequence=seq9'])
            expect(urls().some(u => u.includes('/api/sync/queue'))).toBe(false)
        })

        it('a second sequential start joins the running one', async () => {
            let answer!: (r: unknown) => void
            vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
                const url = String(input)
                if (url.includes('/api/sync/start-all')) return new Promise(resolve => { answer = resolve })
                return Promise.resolve(reply({ sequence: { id: 's', services: ['yodel'], current_index: 0, blocking: true, state: 'complete', completed: ['yodel'], failed: [] } }))
            }))
            const { result } = renderHook(() => useSync(unconfigured))
            let first: Promise<unknown> = Promise.resolve()
            let second: Promise<unknown> = Promise.resolve()
            act(() => {
                first = result.current.startSequentialSync(['yodel'])
                second = result.current.startSequentialSync(['yodel', 'nogizaka46'])
            })
            expect(second).toBe(first)
            await act(async () => { answer(reply({ sequence_id: 's', results: {} })); await first })
            expect(urls().filter(u => u.includes('/api/sync/start-all'))).toHaveLength(1)
        })

        it('a fresh output folder opens the blocking sequence at startup', async () => {
            const bodies: unknown[] = []
            vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = String(input)
                if (url.includes('/api/settings/fresh')) return reply({ is_fresh: true })
                if (url.includes('/api/sync/start-all')) { bodies.push(JSON.parse(String(init?.body))); return reply({ sequence_id: 's1', results: {} }) }
                if (url.includes('/api/sync/queue')) return reply({ sequence: bodies.length ? { id: 's1', services: ['hinatazaka46'], current_index: 0, blocking: true, state: 'running', completed: [], failed: [] } : null })
                return reply({ state: 'running', phase: 'syncing', completed: 0, total: 1 })
            }))
            const { result } = renderHook(() => useSync(defaultOptions))
            await waitFor(() => expect(bodies).toEqual([{ services: ['hinatazaka46'], blocking: true }]))
            expect(result.current.showSyncModal).toBe(true)
        })

        it('a refused background start-all marks each service as failed to start', async () => {
            vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
                const url = String(input)
                if (url.includes('/api/sync/start-all')) return reply({ detail: 'boom' }, 503)
                if (url.includes('/api/sync/queue')) return reply({ sequence: null })
                return reply({ is_fresh: false })
            }))
            const { result } = renderHook(() => useSync({ ...defaultOptions, connectedServices: ['hinatazaka46', 'yodel'] }))
            await waitFor(() => expect(result.current.syncProgressByService['yodel']?.state).toBe('error'))
            expect(result.current.syncProgressByService['hinatazaka46']?.state).toBe('error')
            expect(clientLog).toHaveBeenCalledWith('sync_start_all_failed', { reason: 'http_503' })
        })
    })

    describe('one start per service (Plan C ledger C-T10)', () => {
        const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
        const urls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url))

        it('a start already in flight for a new login is not queued again by the start-up sync', async () => {
            let answerStart: (v: unknown) => void = () => {}
            vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
                const url = String(input)
                if (url.includes('/api/sync/start?')) return new Promise(resolve => { answerStart = resolve })
                if (url.includes('/api/settings/fresh')) return reply({ is_fresh: false })
                if (url.includes('/api/sync/queue')) return reply({ running: null, queued: [], sequence: null })
                if (url.includes('/api/sync/start-all')) return reply({ sequence_id: 's', results: {} })
                return reply({ state: 'running', phase: 'syncing', completed: 0, total: 1 })
            }))
            const { result, rerender } = renderHook((props: typeof defaultOptions) => useSync(props), {
                initialProps: { ...defaultOptions, connectedServices: [] as string[] },
            })
            act(() => { void result.current.startSync(false, 'hinatazaka46') })
            rerender({ ...defaultOptions, connectedServices: ['hinatazaka46'] })
            await waitFor(() => expect(clientLog).toHaveBeenCalledWith('sync_start_skipped', { reason: 'starting', count: 1 }))
            expect(urls().filter(u => u.includes('/api/sync/start-all'))).toHaveLength(0)
            await act(async () => { answerStart(reply({})) })
        })

        it('a start-all in flight makes a later startSync for the same service a no-op', async () => {
            let answerAll: (v: unknown) => void = () => {}
            vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
                const url = String(input)
                if (url.includes('/api/sync/start-all')) return new Promise(resolve => { answerAll = resolve })
                if (url.includes('/api/sync/queue')) return reply({ running: null, queued: [], sequence: null })
                return reply({ state: 'running', phase: 'syncing', completed: 0, total: 1 })
            }))
            const { result } = renderHook(() => useSync({ ...defaultOptions, isAuthenticated: false }))
            act(() => { void result.current.startSyncAllServices(false) })
            await act(async () => { await result.current.startSync(false, 'hinatazaka46') })
            expect(urls().some(u => u.includes('/api/sync/start?'))).toBe(false)
            expect(clientLog).toHaveBeenCalledWith('sync_start_skipped', { reason: 'starting' })
            await act(async () => { answerAll(reply({ sequence_id: 's', results: {} })) })
        })
    })
})
