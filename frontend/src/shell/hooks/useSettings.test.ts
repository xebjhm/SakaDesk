import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useSettings } from './useSettings'
import { getListSnapshot, rememberListSnapshot } from '../../features/messages/listSnapshotStore'

// ── Hoisted mocks for appStore ──────────────────────────────────────────────
// selectedServices is mutable so each test can configure it independently.
const { mockSelectedServices } = vi.hoisted(() => ({
    mockSelectedServices: { value: [] as string[] },
}))

vi.mock('../../store/appStore', () => {
    const mockUseAppStore = Object.assign(
        (select: (s: unknown) => unknown) => select({
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

describe('useSettings – save error', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockSelectedServices.value = ['hinatazaka46']
    })

    it('stores an i18n key on a failed save and clears it on the next successful save', async () => {
        const { impl } = buildFetch()
        let failPost = true
        vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
            if (failPost && (init?.method ?? 'GET').toUpperCase() === 'POST' && input === '/api/settings') {
                return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
            }
            return impl(input, init)
        }))

        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)

        await act(async () => { await result.current.saveSettings({ auto_sync_enabled: true }) })
        expect(result.current.settingsErrorKey).toBe('settings.saveFailed')

        failPost = false
        await act(async () => { await result.current.saveSettings({ auto_sync_enabled: true }) })
        expect(result.current.settingsErrorKey).toBeNull()
    })

    it('clearSettingsError dismisses the error', async () => {
        const { impl } = buildFetch()
        vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
            if ((init?.method ?? 'GET').toUpperCase() === 'POST' && input === '/api/settings') {
                return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
            }
            return impl(input, init)
        }))

        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)
        await act(async () => { await result.current.saveSettings({ auto_sync_enabled: true }) })
        expect(result.current.settingsErrorKey).toBe('settings.saveFailed')
        act(() => { result.current.clearSettingsError() })
        expect(result.current.settingsErrorKey).toBeNull()
    })
})

describe('useSettings – list snapshots (W3)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockSelectedServices.value = ['hinatazaka46']
    })

    it('an output-dir change forgets the chat list snapshots; other saves keep them', async () => {
        const { impl } = buildFetch()
        vi.stubGlobal('fetch', vi.fn(impl))
        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)
        const root = document.createElement('div')
        root.textContent = '日向坂 🌸'
        rememberListSnapshot('room', root, 0)
        await act(async () => { await result.current.saveSettings({ blogs_full_backup: true }) })
        expect(getListSnapshot('room')).not.toBeNull()
        await act(async () => { await result.current.saveSettings({ output_dir: '/tmp/other' }) })
        expect(getListSnapshot('room')).toBeNull()
    })
})

describe('useSettings – output folder picker (security audit 2026-11-13)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockSelectedServices.value = ['hinatazaka46']
    })

    function withPicker(reply: Record<string, unknown>) {
        const { impl } = buildFetch()
        vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
            if (input === '/api/settings/select-folder') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(reply) })
            }
            return impl(input, init)
        }))
    }

    it('Browse puts the picked folder in the field and clears an earlier picker error', async () => {
        withPicker({ path: null, error: 'busy' })
        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)
        await act(async () => { await result.current.handleSelectFolder() })
        expect(result.current.folderErrorKey).toBe('settings.outputDirError.busy')
        expect(result.current.outputDirInput).toBe('/tmp/test')

        withPicker({ path: 'D:\\データ' })
        await act(async () => { await result.current.handleSelectFolder() })
        expect(result.current.outputDirInput).toBe('D:\\データ')
        expect(result.current.folderErrorKey).toBeNull()
    })

    it('a refused output folder on save shows its reason', async () => {
        const { impl } = buildFetch()
        vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
            if ((init?.method ?? 'GET').toUpperCase() === 'POST' && input === '/api/settings') {
                return Promise.resolve({
                    ok: false,
                    json: () => Promise.resolve({ detail: { code: 'output_dir_rejected', reason: 'not_picked' } }),
                })
            }
            return impl(input, init)
        }))
        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)
        let ok = true
        await act(async () => { ok = await result.current.saveSettings({ output_dir: 'D:\\typed' }) })
        expect(ok).toBe(false)
        expect(result.current.settingsErrorKey).toBe('settings.outputDirError.not_picked')
    })

    const refused = (reason: string) => ({
        ok: false,
        json: () => Promise.resolve({ detail: { code: 'output_dir_rejected', reason } }),
    })

    /** fetch whose picker waits for `release()` and whose POST /api/settings answers `postReply`. */
    function deferredPicker(postReply?: unknown) {
        const { impl } = buildFetch()
        let release: (v: unknown) => void = () => {}
        vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
            if (input === '/api/settings/select-folder') {
                return new Promise((resolve) => {
                    release = (body) => resolve({ ok: true, json: () => Promise.resolve(body) })
                })
            }
            if ((init?.method ?? 'GET').toUpperCase() === 'POST' && input === '/api/settings' && postReply) {
                return Promise.resolve(postReply)
            }
            return impl(input, init)
        }))
        return { release: (body: unknown) => release(body) }
    }

    it('a refused output folder on save also shows its reason by the field', async () => {
        const { impl } = buildFetch()
        vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) =>
            (init?.method ?? 'GET').toUpperCase() === 'POST' && input === '/api/settings'
                ? Promise.resolve(refused('not_picked'))
                : impl(input, init)))
        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)
        await act(async () => { await result.current.saveSettings({ output_dir: 'D:\\typed' }) })
        expect(result.current.folderErrorKey).toBe('settings.outputDirError.not_picked')
    })

    it('a save of something else leaves the folder message alone', async () => {
        withPicker({ path: null, error: 'busy' })
        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)
        await act(async () => { await result.current.handleSelectFolder() })
        await act(async () => { await result.current.saveSettings({ blogs_full_backup: true }) })
        expect(result.current.folderErrorKey).toBe('settings.outputDirError.busy')
    })

    it('a save of something else keeps a picked but unsaved folder in the field', async () => {
        withPicker({ path: 'D:\\データ' })
        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)
        await act(async () => { await result.current.handleSelectFolder() })
        expect(result.current.outputDirInput).toBe('D:\\データ')
        await act(async () => { await result.current.saveSettings({ blogs_full_backup: true }) })
        expect(result.current.outputDirInput).toBe('D:\\データ')
    })

    it('the newest word wins: a save of the folder drops an older picker error, a success leaves none', async () => {
        withPicker({ path: null, error: 'busy' })
        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)
        await act(async () => { await result.current.handleSelectFolder() })
        expect(result.current.folderErrorKey).toBe('settings.outputDirError.busy')
        await act(async () => { await result.current.saveSettings({ output_dir: '/tmp/test' }) })
        expect(result.current.folderErrorKey).toBeNull()
    })

    it('a generic failed save replaces an older picker error', async () => {
        const { impl } = buildFetch()
        let pick = true
        vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
            if (input === '/api/settings/select-folder') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ path: null, error: 'busy' }) })
            }
            if (!pick && (init?.method ?? 'GET').toUpperCase() === 'POST' && input === '/api/settings') {
                return Promise.resolve({ ok: false, json: () => Promise.resolve({ detail: 'x' }) })
            }
            return impl(input, init)
        }))
        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)
        await act(async () => { await result.current.handleSelectFolder() })
        pick = false
        await act(async () => { await result.current.saveSettings({ output_dir: '/x' }) })
        expect(result.current.folderErrorKey).toBeNull()
        expect(result.current.settingsErrorKey).toBe('settings.saveFailed')
    })

    it('opening or closing Settings drops a picked but unsaved folder', async () => {
        withPicker({ path: 'D:\\データ' })
        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)
        await act(async () => { result.current.openSettingsModal() })
        await act(async () => { await result.current.handleSelectFolder() })
        expect(result.current.outputDirInput).toBe('D:\\データ')
        act(() => { result.current.setShowSettingsModal(false) })
        expect(result.current.outputDirInput).toBe('/tmp/test')

        await act(async () => { await result.current.handleSelectFolder() })
        expect(result.current.outputDirInput).toBe('D:\\データ')
        await act(async () => { result.current.openSettingsModal() })
        expect(result.current.outputDirInput).toBe('/tmp/test')
    })

    it('a picker result that arrives after Settings closed is ignored', async () => {
        const picker = deferredPicker()
        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)
        await act(async () => { result.current.openSettingsModal() })
        let pending: Promise<void> = Promise.resolve()
        act(() => { pending = result.current.handleSelectFolder() })
        act(() => { result.current.setShowSettingsModal(false) })
        await act(async () => { picker.release({ path: 'D:\\late' }); await pending })
        expect(result.current.outputDirInput).toBe('/tmp/test')
        expect(result.current.folderErrorKey).toBeNull()
    })

    it('a picker result that arrives after the folder save started is ignored', async () => {
        const picker = deferredPicker()
        const { result } = renderHook(() => useSettings(true))
        await waitForMount(result)
        let pending: Promise<void> = Promise.resolve()
        act(() => { pending = result.current.handleSelectFolder() })
        await act(async () => { await result.current.saveSettings({ output_dir: '/tmp/test' }) })
        await act(async () => { picker.release({ path: null, error: 'busy' }); await pending })
        expect(result.current.folderErrorKey).toBeNull()
    })
})
