import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useSettings } from './useSettings'

// ── Hoisted mocks for appStore ──────────────────────────────────────────────
// selectedServices is mutable so each test can configure it independently.
const { mockSelectedServices } = vi.hoisted(() => ({
    mockSelectedServices: { value: [] as string[] },
}))

vi.mock('../../store/appStore', () => {
    const mockUseAppStore = Object.assign(
        () => ({
            activeService: null,
            selectedServices: mockSelectedServices.value,
        }),
        {
            getState: () => ({
                selectedServices: mockSelectedServices.value,
            }),
        },
    )
    return { useAppStore: mockUseAppStore }
})

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a mock fetch that routes by URL and method. */
function buildFetch(overrides: {
    settingsPostResponse?: Record<string, unknown>
} = {}) {
    const calls: { url: string; method: string }[] = []

    const settingsGetResponse = {
        output_dir: '/tmp/test',
        auto_sync_enabled: false,
        sync_interval_minutes: 30,
        is_configured: true,
        blogs_full_backup: false,
    }

    const settingsPostResponse = overrides.settingsPostResponse ?? {
        ...settingsGetResponse,
        ...{ blogs_full_backup: true },
    }

    const impl = (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        const method = (init?.method ?? 'GET').toUpperCase()
        calls.push({ url, method })

        // GET /api/settings (mount effect)
        if (url === '/api/settings' && method === 'GET') {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(settingsGetResponse),
            })
        }

        // POST /api/settings (saveSettings)
        if (url === '/api/settings' && method === 'POST') {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(settingsPostResponse),
            })
        }

        // GET /api/settings/service/:service (loadServiceSettings mount effect)
        if (url.startsWith('/api/settings/service/') && method === 'GET') {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ blogs_full_backup: false, sync_enabled: false, adaptive_sync_enabled: false, last_sync: null }),
            })
        }

        // Blog backup start/stop
        if (url.startsWith('/api/blogs/backup/') && method === 'POST') {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ success: true }),
            })
        }

        // GET /api/profile (nickname effect)
        if (url.startsWith('/api/profile') && method === 'GET') {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ nickname: null }),
            })
        }

        // Fallback: return an ok empty response so unhandled calls don't throw
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({}),
        })
    }

    return { calls, impl }
}

/** Wait for the mount-time GET /api/settings to resolve so the hook is stable. */
async function waitForMount(result: { current: ReturnType<typeof useSettings> }) {
    await waitFor(() => {
        expect(result.current.appSettings).not.toBeNull()
    })
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useSettings – blog backup side effect', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockSelectedServices.value = ['hinatazaka46']
    })

    it('calls /api/blogs/backup/start when blogs_full_backup is set to true and is_configured', async () => {
        const { calls, impl } = buildFetch({
            settingsPostResponse: {
                output_dir: '/tmp/test',
                auto_sync_enabled: false,
                sync_interval_minutes: 30,
                is_configured: true,
                blogs_full_backup: true,
            },
        })
        vi.stubGlobal('fetch', vi.fn(impl))

        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)

        await act(async () => {
            await result.current.saveSettings({ blogs_full_backup: true })
        })

        // Let the fire-and-forget backup fetch resolve
        await waitFor(() => {
            const backupCalls = calls.filter(c => c.url.startsWith('/api/blogs/backup/start'))
            expect(backupCalls).toHaveLength(1)
        })

        const startCall = calls.find(c => c.url.startsWith('/api/blogs/backup/start'))!
        expect(startCall.method).toBe('POST')
        // hinatazaka46 supports blogs, so it should appear in the query params
        expect(startCall.url).toContain('services=hinatazaka46')
    })

    it('calls /api/blogs/backup/stop when blogs_full_backup is set to false', async () => {
        const { calls, impl } = buildFetch({
            settingsPostResponse: {
                output_dir: '/tmp/test',
                auto_sync_enabled: false,
                sync_interval_minutes: 30,
                is_configured: true,
                blogs_full_backup: false,
            },
        })
        vi.stubGlobal('fetch', vi.fn(impl))

        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)

        await act(async () => {
            await result.current.saveSettings({ blogs_full_backup: false })
        })

        await waitFor(() => {
            const stopCalls = calls.filter(c => c.url === '/api/blogs/backup/stop')
            expect(stopCalls).toHaveLength(1)
        })

        const stopCall = calls.find(c => c.url === '/api/blogs/backup/stop')!
        expect(stopCall.method).toBe('POST')
    })

    it('does NOT call backup/start when is_configured is false (timing bug guard)', async () => {
        const { calls, impl } = buildFetch({
            settingsPostResponse: {
                output_dir: '/tmp/test',
                auto_sync_enabled: false,
                sync_interval_minutes: 30,
                is_configured: false,
                blogs_full_backup: true,
            },
        })
        vi.stubGlobal('fetch', vi.fn(impl))

        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)

        await act(async () => {
            await result.current.saveSettings({ blogs_full_backup: true })
        })

        // Verify no backup calls were made
        await waitFor(() => {
            expect(fetch).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'POST' }))
        })

        const backupCalls = calls.filter(c => c.url.startsWith('/api/blogs/backup/'))
        expect(backupCalls).toHaveLength(0)
    })

    it('does NOT call any backup endpoint when saving unrelated settings', async () => {
        const { calls, impl } = buildFetch({
            settingsPostResponse: {
                output_dir: '/tmp/new_dir',
                auto_sync_enabled: false,
                sync_interval_minutes: 30,
                is_configured: true,
                blogs_full_backup: false,
            },
        })
        vi.stubGlobal('fetch', vi.fn(impl))

        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)

        await act(async () => {
            await result.current.saveSettings({ output_dir: '/tmp/new_dir' })
        })

        // Verify no backup calls were made
        await waitFor(() => {
            expect(fetch).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'POST' }))
        })

        const backupCalls = calls.filter(c => c.url.startsWith('/api/blogs/backup/'))
        expect(backupCalls).toHaveLength(0)
    })

    it('excludes services that do not support blogs from the start query', async () => {
        // yodel does NOT have 'blogs' in SERVICE_FEATURES
        mockSelectedServices.value = ['hinatazaka46', 'yodel']

        const { calls, impl } = buildFetch({
            settingsPostResponse: {
                output_dir: '/tmp/test',
                auto_sync_enabled: false,
                sync_interval_minutes: 30,
                is_configured: true,
                blogs_full_backup: true,
            },
        })
        vi.stubGlobal('fetch', vi.fn(impl))

        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)

        await act(async () => {
            await result.current.saveSettings({ blogs_full_backup: true })
        })

        await waitFor(() => {
            const startCalls = calls.filter(c => c.url.startsWith('/api/blogs/backup/start'))
            expect(startCalls).toHaveLength(1)
        })

        const startCall = calls.find(c => c.url.startsWith('/api/blogs/backup/start'))!
        expect(startCall.url).toContain('services=hinatazaka46')
        expect(startCall.url).not.toContain('yodel')
    })

    it('does NOT call backup/start when blogs_full_backup is true but no services support blogs', async () => {
        // yodel is the only selected service and it does not support blogs
        mockSelectedServices.value = ['yodel']

        const { calls, impl } = buildFetch({
            settingsPostResponse: {
                output_dir: '/tmp/test',
                auto_sync_enabled: false,
                sync_interval_minutes: 30,
                is_configured: true,
                blogs_full_backup: true,
            },
        })
        vi.stubGlobal('fetch', vi.fn(impl))

        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)

        await act(async () => {
            await result.current.saveSettings({ blogs_full_backup: true })
        })

        // Verify no backup calls were made
        await waitFor(() => {
            expect(fetch).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'POST' }))
        })

        const backupCalls = calls.filter(c => c.url.startsWith('/api/blogs/backup/'))
        expect(backupCalls).toHaveLength(0)
    })
})
