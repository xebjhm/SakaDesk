import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../__tests__/mocks/server'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { useAppStore } from '../store/appStore'

// Regression: upgrading users who already accepted the ToS were bounced back to
// the ToS gate on first launch of the backend-persisted build. Root cause: the
// `tosAccepted` state was latched by a useState initializer at mount, when the
// synchronous prefs cache is still EMPTY — it only fills after hydratePrefs()
// resolves. This test models that timing faithfully (acceptance lives ONLY in
// the backend endpoint, NOT in the mount-time cache), unlike the mock-based
// integration test which stubs getPref to return the value synchronously and
// therefore never exercised the gap.
describe('ToS gate after backend prefs hydration', () => {
  beforeEach(() => {
    server.use(
      // Backend already holds the migrated acceptance + language.
      http.get('*/api/app-state/prefs', () =>
        HttpResponse.json({ tos_accepted_at: '2024-01-01T00:00:00Z', language: 'en' })),
      http.patch('*/api/app-state/prefs', () => HttpResponse.json({ ok: true })),
      http.get('*/api/app-state/migrate', () => HttpResponse.json({ migrated: true })),
      http.get('*/api/app-state/conversation-all', () => HttpResponse.json({})),
    )
    // A selected service so we land on the main app (not the landing page)
    // once the ToS + loading gates open.
    useAppStore.setState({
      selectedServices: ['hinatazaka46'],
      activeService: 'hinatazaka46',
    })
  })

  it('opens the app (does not re-gate on ToS) when acceptance is only in the backend', async () => {
    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    )

    // The app must reach main content — proving it got PAST the ToS gate after
    // hydration, rather than staying stuck on the dialog.
    await waitFor(() => {
      expect(screen.getByText('Test Member')).toBeInTheDocument()
    })

    // And the ToS accept button must not be present.
    expect(
      screen.queryByText(/tos\.acceptAndContinue|Accept and Continue/i),
    ).not.toBeInTheDocument()
  })
})
