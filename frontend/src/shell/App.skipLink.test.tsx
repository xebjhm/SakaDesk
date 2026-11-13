import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../__tests__/mocks/server'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { useAppStore } from '../store/appStore'
import { persisted } from '../core/persistence/persisted'
import i18n from '../i18n'

const SKIP = { name: 'Skip to content' }

// The skip link is the first Tab stop of the app shell. It exists only with the main landmark it
// jumps to, which the layout renders after onboarding (not during the setup wizard).
describe('App skip link gating', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.spyOn(persisted, 'getPref').mockImplementation(<T,>(key: string, fallback: T): T => {
      if (key === 'tos_accepted_at') return '2024-01-01T00:00:00Z' as unknown as T
      if (key === 'language') return 'en' as unknown as T
      return fallback
    })
    useAppStore.setState({
      selectedServices: ['hinatazaka46'],
      activeService: 'hinatazaka46',
      activeFeatures: {},
    })
    server.use(
      http.get('*/api/app-state/prefs', () => HttpResponse.json({})),
      http.patch('*/api/app-state/prefs', () => HttpResponse.json({ ok: true })),
      http.get('*/api/app-state/migrate', () => HttpResponse.json({ migrated: true })),
      http.get('*/api/app-state/conversation-all', () => HttpResponse.json({})),
      http.get('*/api/sync/queue', () => HttpResponse.json({ running: null, queued: [], sequence: null })),
      http.post('*/api/sync/start-all', () => HttpResponse.json({ sequence_id: 's1', results: {} })),
    )
  })

  afterEach(() => vi.restoreAllMocks())

  it('is offered once the main landmark exists', async () => {
    render(<AuthProvider><App /></AuthProvider>)
    await vi.waitFor(() => expect(document.getElementById('sd-main')).not.toBeNull())
    expect(await screen.findByRole('button', SKIP)).toBeInTheDocument()
  })

  it('is not offered while the setup wizard is up', async () => {
    server.use(
      http.get('/api/settings', () => HttpResponse.json({ output_dir: '', is_configured: false })),
    )
    render(<AuthProvider><App /></AuthProvider>)
    await screen.findByText(i18n.t('setup.welcome'))
    expect(screen.queryByRole('button', SKIP)).toBeNull()
  })
})
