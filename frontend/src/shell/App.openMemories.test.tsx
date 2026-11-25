import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../__tests__/mocks/server'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { useAppStore } from '../store/appStore'
import { persisted } from '../core/persistence/persisted'
import i18n from '../i18n'
import { clientLog } from '../utils/clientLog'

vi.mock('../utils/clientLog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/clientLog')>()),
  clientLog: vi.fn(),
}))

const RECAP = { service: 'sakurazaka46', route: { page: 'recap', year: 2026 } }

// Desktop Memories toast click: window.__sakadeskOpenMemories(payload) opens Memories
// at the toast's page; refused for an unknown service or during onboarding.
describe('App window.__sakadeskOpenMemories', () => {
  beforeEach(() => {
    vi.mocked(clientLog).mockClear()
    vi.spyOn(persisted, 'getPref').mockImplementation(<T,>(key: string, fallback: T): T => {
      if (key === 'tos_accepted_at') return '2024-01-01T00:00:00Z' as unknown as T
      if (key === 'language') return 'en' as unknown as T
      return fallback
    })
    useAppStore.setState({
      selectedServices: ['hinatazaka46', 'sakurazaka46'],
      activeService: 'hinatazaka46',
      activeFeatures: {},
      memoriesDeepLink: null,
    })
    server.use(
      http.get('*/api/app-state/prefs', () => HttpResponse.json({})),
      http.patch('*/api/app-state/prefs', () => HttpResponse.json({ ok: true })),
      http.get('*/api/app-state/migrate', () => HttpResponse.json({ migrated: true })),
      http.get('*/api/app-state/conversation-all', () => HttpResponse.json({})),
    )
  })

  afterEach(() => {
    delete window.__sakadeskOpenMemories
    vi.restoreAllMocks()
  })

  it('switches service, shows Memories and stores the link', async () => {
    render(<AuthProvider><App /></AuthProvider>)
    await vi.waitFor(() => expect(window.__sakadeskOpenMemories).toBeTypeOf('function'))

    let result: boolean | undefined
    act(() => { result = window.__sakadeskOpenMemories!(RECAP) })

    expect(result).toBe(true)
    const s = useAppStore.getState()
    expect(s.activeService).toBe('sakurazaka46')
    expect(s.activeFeatures.sakurazaka46).toBe('memories')
    expect(clientLog).toHaveBeenCalledWith('notify_open_memories', {
      delivered: true, service: 'sakurazaka46', target: 'recap',
    })
  })

  it('refuses a service the user has not added', async () => {
    render(<AuthProvider><App /></AuthProvider>)
    await vi.waitFor(() => expect(window.__sakadeskOpenMemories).toBeTypeOf('function'))

    let result: boolean | undefined
    act(() => { result = window.__sakadeskOpenMemories!({ ...RECAP, service: 'nogizaka46' }) })

    expect(result).toBe(false)
    expect(useAppStore.getState().activeService).toBe('hinatazaka46')
    expect(useAppStore.getState().memoriesDeepLink).toBeNull()
  })

  it('refuses during onboarding (setup wizard up)', async () => {
    server.use(
      http.get('/api/settings', () => HttpResponse.json({ output_dir: '', is_configured: false })),
    )
    render(<AuthProvider><App /></AuthProvider>)
    await vi.waitFor(() => expect(window.__sakadeskOpenMemories).toBeTypeOf('function'))
    await screen.findByText(i18n.t('setup.welcome'))

    let result: boolean | undefined
    act(() => { result = window.__sakadeskOpenMemories!(RECAP) })

    expect(result).toBe(false)
    expect(useAppStore.getState().memoriesDeepLink).toBeNull()
    expect(clientLog).toHaveBeenCalledWith('notify_open_memories', {
      delivered: false, reason: 'onboarding', service: 'sakurazaka46',
    })
  })

  it('removes the global on unmount', async () => {
    const { unmount } = render(<AuthProvider><App /></AuthProvider>)
    await vi.waitFor(() => expect(window.__sakadeskOpenMemories).toBeTypeOf('function'))
    unmount()
    expect(window.__sakadeskOpenMemories).toBeUndefined()
  })
})
