import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../__tests__/mocks/server'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { useAppStore } from '../store/appStore'
import { persisted } from '../core/persistence/persisted'
import { clientLog } from '../utils/clientLog'
import i18n from '../i18n'

vi.mock('../utils/clientLog', async (orig) => ({ ...(await orig<typeof import('../utils/clientLog')>()), clientLog: vi.fn() }))

// First-launch setup: the backend refuses the picked folder. The wizard stays open, says why
// inside the dialog (the toast sits outside its focus trap) and the failure leaves a breadcrumb.
describe('App setup: a refused output folder', () => {
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
      http.get('*/api/settings', () => HttpResponse.json({
        output_dir: '', auto_sync_enabled: false, sync_interval_minutes: 30,
        adaptive_sync_enabled: false, blogs_full_backup: false, is_configured: false,
      })),
      http.post('*/api/settings/select-folder', () => HttpResponse.json({ path: 'C:\\SakaDesk-データ' })),
      http.post('*/api/settings', () => HttpResponse.json(
        { detail: { code: 'output_dir_rejected', reason: 'app_data' } }, { status: 400 },
      )),
    )
  })

  it('shows the reason in the wizard and logs setup_save_failed', async () => {
    const user = userEvent.setup()
    render(<AuthProvider><App /></AuthProvider>)
    await user.click(await screen.findByRole('button', { name: 'Browse' }))
    await screen.findByDisplayValue('C:\\SakaDesk-データ')
    await user.click(screen.getByRole('button', { name: 'Start Using SakaDesk' }))

    const dialog = await screen.findByRole('dialog', { name: i18n.t('setup.welcome') })
    const reasons = await screen.findAllByText(i18n.t('settings.outputDirError.app_data'))
    expect(reasons.some((el) => dialog.contains(el))).toBe(true)
    expect(clientLog).toHaveBeenCalledWith('setup_save_failed', { reason: 'save_refused' })
  })

  it('shows a generic save failure by the folder field too (the toast waits for the dialog)', async () => {
    server.use(http.post('*/api/settings', () => new HttpResponse(null, { status: 500 })))
    const user = userEvent.setup()
    render(<AuthProvider><App /></AuthProvider>)
    await user.click(await screen.findByRole('button', { name: 'Browse' }))
    await screen.findByDisplayValue('C:\\SakaDesk-データ')
    await user.click(screen.getByRole('button', { name: 'Start Using SakaDesk' }))

    const dialog = await screen.findByRole('dialog', { name: i18n.t('setup.welcome') })
    const reasons = await screen.findAllByText(i18n.t('settings.saveFailed'))
    expect(reasons.some((el) => dialog.contains(el))).toBe(true)
  })
})
