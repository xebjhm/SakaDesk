import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../__tests__/mocks/server'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { useAppStore } from '../store/appStore'
import { persisted } from '../core/persistence/persisted'
import { Z_INDEX } from '../constants/zIndex'
import i18n from '../i18n'

// A failed settings save must be visible while Settings is open: the toast sits on the
// toast layer, above the dialog scrim.
describe('App settings error toast', () => {
  beforeEach(() => {
    vi.spyOn(persisted, 'getPref').mockImplementation(<T,>(key: string, fallback: T): T => {
      if (key === 'tos_accepted_at') return '2024-01-01T00:00:00Z' as unknown as T
      if (key === 'language') return 'en' as unknown as T
      return fallback
    })
    useAppStore.setState({ selectedServices: ['hinatazaka46'], activeService: 'hinatazaka46' })
  })

  it('renders above the open Settings dialog', async () => {
    server.use(http.post('/api/settings', () => new HttpResponse(null, { status: 500 })))
    const user = userEvent.setup()
    render(<AuthProvider><App /></AuthProvider>)

    await user.click(await screen.findByRole('button', { name: i18n.t('common.settings') }))
    await user.click(await screen.findByRole('menuitem', { name: i18n.t('common.settings') }))
    const dialog = await screen.findByRole('dialog', { name: i18n.t('settings.title') })
    await user.click(within(dialog).getByRole('switch', { name: i18n.t('settings.closeToTray') }))

    const toast = await screen.findByTestId('settings-error-toast')
    expect(toast.style.zIndex).toBe(String(Z_INDEX.TOAST))
    const backdrop = dialog.closest('[data-testid="modal-backdrop"]') as HTMLElement
    expect(Number(toast.style.zIndex)).toBeGreaterThan(Number(backdrop.style.zIndex))
    // The row says it too.
    expect(within(dialog).getByText(i18n.t('settings.saveFailed'))).toBeInTheDocument()
  })
})
