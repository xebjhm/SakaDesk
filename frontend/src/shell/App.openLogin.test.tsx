import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../__tests__/mocks/server'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { useAppStore } from '../store/appStore'
import { persisted } from '../core/persistence/persisted'
import i18n from '../i18n'

// Desktop "log in again" toast click: window.__sakadeskOpenLogin(service) shows that
// service and its login dialog; a service the user has not added is refused.
describe('App window.__sakadeskOpenLogin', () => {
  beforeEach(() => {
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

  it('removes the global on unmount', async () => {
    const { unmount } = render(<AuthProvider><App /></AuthProvider>)
    await vi.waitFor(() => expect(window.__sakadeskOpenLogin).toBeTypeOf('function'))
    unmount()
    expect(window.__sakadeskOpenLogin).toBeUndefined()
  })
})
