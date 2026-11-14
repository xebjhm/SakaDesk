import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../__tests__/mocks/server'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { useAppStore } from '../store/appStore'
import { persisted } from '../core/persistence/persisted'
import { Z_INDEX } from '../constants/zIndex'
import i18n from '../i18n'
import { clientLog } from '../utils/clientLog'

vi.mock('../utils/clientLog', async (orig) => ({ ...(await orig<typeof import('../utils/clientLog')>()), clientLog: vi.fn() }))

/** Opens Settings, flips a switch whose save fails, and returns the dialog (the toast waits for it to close). */
async function failASave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: i18n.t('common.settings') }))
  await user.click(await screen.findByRole('menuitem', { name: i18n.t('common.settings') }))
  const dialog = await screen.findByRole('dialog', { name: i18n.t('settings.title') })
  const toggle = within(dialog).getByRole('switch', { name: i18n.t('settings.closeToTray') })
  await user.click(toggle)
  await within(dialog).findByText(i18n.t('settings.saveFailed'))
  return { dialog, toggle }
}

// A failed settings save shows on the Settings row; the toast (in #root, inert while a dialog is
// open) waits for the dialogs to close and then appears on the toast layer.
describe('App settings error toast', () => {
  beforeEach(() => {
    vi.mocked(clientLog).mockClear()
    vi.spyOn(persisted, 'getPref').mockImplementation(<T,>(key: string, fallback: T): T => {
      if (key === 'tos_accepted_at') return '2024-01-01T00:00:00Z' as unknown as T
      if (key === 'language') return 'en' as unknown as T
      return fallback
    })
    useAppStore.setState({ selectedServices: ['hinatazaka46'], activeService: 'hinatazaka46' })
    server.use(
      http.get('*/api/app-state/prefs', () => HttpResponse.json({})),
      http.patch('*/api/app-state/prefs', () => HttpResponse.json({ ok: true })),
      http.get('*/api/app-state/migrate', () => HttpResponse.json({ migrated: true })),
      http.get('*/api/app-state/conversation-all', () => HttpResponse.json({})),
    )
  })

  it('waits while Settings is open, then shows once on close', async () => {
    server.use(http.post('/api/settings', () => new HttpResponse(null, { status: 500 })))
    const user = userEvent.setup()
    render(<AuthProvider><App /></AuthProvider>)
    const { dialog } = await failASave(user)

    // The row says it; the toast waits, and the deferral is logged once.
    expect(screen.queryByTestId('settings-error-toast')).toBeNull()
    const deferrals = () => vi.mocked(clientLog).mock.calls.filter(
      ([event, fields]) => event === 'dialog' && fields?.target === 'settings_error_toast' && fields?.outcome === 'suppressed',
    )
    expect(deferrals()).toHaveLength(1)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: i18n.t('settings.title') })).toBeNull())
    expect(dialog).not.toBeInTheDocument()
    const toast = await screen.findByTestId('settings-error-toast')
    expect(toast.style.zIndex).toBe(String(Z_INDEX.TOAST))
    expect(deferrals()).toHaveLength(1)
    // D2d: a translated status card with a Debug action.
    expect(toast).toHaveAttribute('role', 'alert')
    expect(within(toast).getByText(i18n.t('common.error'))).toBeInTheDocument()
    expect(within(toast).getByText(i18n.t('settings.saveFailed'))).toBeInTheDocument()
    expect(within(toast).getByRole('button', { name: i18n.t('common.debug') })).toBeInTheDocument()
    expect(toast).toHaveClass('bg-card', 'rounded-card')
  })

  it('closes with its close button and follows a language change', async () => {
    server.use(http.post('/api/settings', () => new HttpResponse(null, { status: 500 })))
    const user = userEvent.setup()
    render(<AuthProvider><App /></AuthProvider>)

    await failASave(user)
    await user.keyboard('{Escape}')
    const toast = await screen.findByTestId('settings-error-toast')
    try {
      await act(async () => { await i18n.changeLanguage('ja') })
      expect(within(toast).getByText(i18n.t('settings.saveFailed'))).toBeInTheDocument()
    } finally {
      await act(async () => { await i18n.changeLanguage('en') })
    }
    await user.click(within(toast).getByRole('button', { name: i18n.t('common.close') }))
    expect(screen.queryByTestId('settings-error-toast')).toBeNull()
  })

  it('Debug opens the diagnostics dialog', async () => {
    server.use(
      http.post('/api/settings', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/diagnostics', () => new HttpResponse(null, { status: 503 })),
    )
    const user = userEvent.setup()
    render(<AuthProvider><App /></AuthProvider>)

    await failASave(user)
    await user.keyboard('{Escape}')
    const toast = await screen.findByTestId('settings-error-toast')
    await user.click(within(toast).getByRole('button', { name: i18n.t('common.debug') }))
    expect(await screen.findByRole('dialog', { name: 'Developer Diagnostics' })).toBeInTheDocument()
  })

  it('shows no toast when a failed save is followed by a successful one', async () => {
    let fail = true
    server.use(http.post('/api/settings', async ({ request }) => {
      if (fail) return new HttpResponse(null, { status: 500 })
      return HttpResponse.json({ output_dir: '/tmp/test', is_configured: true, ...(await request.json() as object) })
    }))
    const user = userEvent.setup()
    render(<AuthProvider><App /></AuthProvider>)

    const { toggle } = await failASave(user)

    fail = false
    await user.click(toggle)
    await waitFor(() => expect(screen.queryByText(i18n.t('settings.saveFailed'))).toBeNull())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: i18n.t('settings.title') })).toBeNull())
    expect(screen.queryByTestId('settings-error-toast')).toBeNull()
  })
})
