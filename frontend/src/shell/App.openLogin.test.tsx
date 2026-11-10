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

// A session-expired modal for one service can be forced on; everything else is the real hook.
const { expired } = vi.hoisted(() => ({ expired: { service: null as string | null } }))
vi.mock('./hooks/useSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks/useSync')>()
  return {
    ...actual,
    useSync: (args: Parameters<typeof actual.useSync>[0]) => {
      const real = actual.useSync(args)
      return expired.service ? { ...real, sessionExpiredService: expired.service } : real
    },
  }
})
vi.mock('../utils/clientLog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/clientLog')>()),
  clientLog: vi.fn(),
}))

// Desktop "log in again" toast click: window.__sakadeskOpenLogin(service) shows that
// service and its login dialog; a service the user has not added is refused.
describe('App window.__sakadeskOpenLogin', () => {
  beforeEach(() => {
    expired.service = null
    vi.mocked(clientLog).mockClear()
    vi.spyOn(persisted, 'getPref').mockImplementation(<T,>(key: string, fallback: T): T => {
      if (key === 'tos_accepted_at') return '2024-01-01T00:00:00Z' as unknown as T
      if (key === 'language') return 'en' as unknown as T
      return fallback
    })
    useAppStore.setState({
      selectedServices: ['hinatazaka46', 'sakurazaka46'],
      activeService: 'hinatazaka46',
    })
    server.use(
      http.get('*/api/app-state/prefs', () => HttpResponse.json({})),
      http.patch('*/api/app-state/prefs', () => HttpResponse.json({ ok: true })),
      http.get('*/api/app-state/migrate', () => HttpResponse.json({ migrated: true })),
      http.get('*/api/app-state/conversation-all', () => HttpResponse.json({})),
    )
  })

  afterEach(() => {
    delete window.__sakadeskOpenLogin
  })

  it('switches to the service and shows its login dialog', async () => {
    render(<AuthProvider><App /></AuthProvider>)
    await vi.waitFor(() => expect(window.__sakadeskOpenLogin).toBeTypeOf('function'))

    let result: boolean | undefined
    act(() => { result = window.__sakadeskOpenLogin!('sakurazaka46') })

    expect(result).toBe(true)
    expect(useAppStore.getState().activeService).toBe('sakurazaka46')
    expect(await screen.findByText(i18n.t('login.sessionExpired'))).toBeInTheDocument()
  })

  it('refuses a service the user has not added', async () => {
    render(<AuthProvider><App /></AuthProvider>)
    await vi.waitFor(() => expect(window.__sakadeskOpenLogin).toBeTypeOf('function'))

    let result: boolean | undefined
    act(() => { result = window.__sakadeskOpenLogin!('nogizaka46') })

    expect(result).toBe(false)
    expect(useAppStore.getState().activeService).toBe('hinatazaka46')
    expect(screen.queryByText(i18n.t('login.sessionExpired'))).toBeNull()
  })

  it('refuses while another service\'s session-expired modal would hide the dialog', async () => {
    expired.service = 'hinatazaka46'
    render(<AuthProvider><App /></AuthProvider>)
    await vi.waitFor(() => expect(window.__sakadeskOpenLogin).toBeTypeOf('function'))

    let result: boolean | undefined
    act(() => { result = window.__sakadeskOpenLogin!('sakurazaka46') })

    expect(result).toBe(false)
    expect(useAppStore.getState().activeService).toBe('hinatazaka46')
    expect(clientLog).toHaveBeenCalledWith('notify_open_login', {
      delivered: false, reason: 'session_expired_modal', service: 'sakurazaka46',
    })
  })

  it('delivers when the session-expired modal is for the same service', async () => {
    expired.service = 'sakurazaka46'
    render(<AuthProvider><App /></AuthProvider>)
    await vi.waitFor(() => expect(window.__sakadeskOpenLogin).toBeTypeOf('function'))

    let result: boolean | undefined
    act(() => { result = window.__sakadeskOpenLogin!('sakurazaka46') })

    expect(result).toBe(true)
    expect(clientLog).toHaveBeenCalledWith('notify_open_login', { delivered: true, service: 'sakurazaka46' })
  })

  it('refuses during onboarding (setup wizard up)', async () => {
    server.use(
      http.get('/api/settings', () => HttpResponse.json({ output_dir: '', is_configured: false })),
    )
    render(<AuthProvider><App /></AuthProvider>)
    await vi.waitFor(() => expect(window.__sakadeskOpenLogin).toBeTypeOf('function'))

    await screen.findByText(i18n.t('setup.welcome'))

    let result: boolean | undefined
    act(() => { result = window.__sakadeskOpenLogin!('sakurazaka46') })
    expect(result).toBe(false)
    expect(clientLog).toHaveBeenCalledWith('notify_open_login', {
      delivered: false, reason: 'onboarding', service: 'sakurazaka46',
    })
  })

  it('removes the global on unmount', async () => {
    const { unmount } = render(<AuthProvider><App /></AuthProvider>)
    await vi.waitFor(() => expect(window.__sakadeskOpenLogin).toBeTypeOf('function'))
    unmount()
    expect(window.__sakadeskOpenLogin).toBeUndefined()
  })
})
