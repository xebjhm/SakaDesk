import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../__tests__/mocks/server'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { useAppStore } from '../store/appStore'
import { persisted } from '../core/persistence/persisted'
import { groupRoles } from '../design/tokens'
import { applyGroupTokens } from '../design/applyTokens'

// The main layout is not under test: a stub keeps its data fetches (unread counts, …) from
// outliving the test.
vi.mock('../core/layout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/layout')>()),
  Layout: () => <div data-testid="layout-stub" />,
}))

const accent = () => document.documentElement.style.getPropertyValue('--ds-group-accent')

function pinPrefs(tosAccepted: boolean) {
  vi.spyOn(persisted, 'getPref').mockImplementation(<T,>(key: string, fallback: T): T => {
    if (key === 'tos_accepted_at') return (tosAccepted ? '2024-01-01T00:00:00Z' : fallback) as unknown as T
    if (key === 'language') return 'en' as unknown as T
    return fallback
  })
}

// Spec D2d decision 3: neutral `default` tokens until ToS is accepted and a group is chosen.
describe('group tokens before a group is chosen', () => {
  beforeEach(() => {
    server.use(
      http.get('*/api/app-state/prefs', () => HttpResponse.json({})),
      http.patch('*/api/app-state/prefs', () => HttpResponse.json({ ok: true })),
      http.get('*/api/app-state/migrate', () => HttpResponse.json({ migrated: true })),
      http.get('*/api/app-state/conversation-all', () => HttpResponse.json({})),
    )
    // Start from a group's tokens, so a neutral result proves App applied `default`.
    applyGroupTokens('sakurazaka')
  })

  it('the landing page is neutral even when a removed group was active; a chosen group applies', async () => {
    pinPrefs(true)
    useAppStore.setState({ selectedServices: [], activeService: 'sakurazaka46' })
    const { unmount } = render(<AuthProvider><App /></AuthProvider>)
    expect(await screen.findByText(/Welcome to SakaDesk|landing\.welcome/)).toBeInTheDocument()
    expect(accent()).toBe(groupRoles('default').action)

    act(() => { useAppStore.setState({ selectedServices: ['sakurazaka46'], activeService: 'sakurazaka46' }) })
    await vi.waitFor(() => expect(accent()).toBe(groupRoles('sakurazaka').action))
    unmount()
  })

  it('the terms are neutral while ToS is not accepted, even with a group selected', async () => {
    pinPrefs(false)
    useAppStore.setState({ selectedServices: ['hinatazaka46'], activeService: 'hinatazaka46' })
    const { unmount } = render(<AuthProvider><App /></AuthProvider>)
    expect(await screen.findByRole('dialog', { name: 'Terms of Service' })).toBeInTheDocument()
    expect(accent()).toBe(groupRoles('default').action)
    unmount()
  })

  it('a fresh first launch (no group, no active service) is neutral', async () => {
    pinPrefs(true)
    useAppStore.setState({ selectedServices: [], activeService: null })
    const { unmount } = render(<AuthProvider><App /></AuthProvider>)
    expect(await screen.findByText(/Welcome to SakaDesk|landing\.welcome/)).toBeInTheDocument()
    expect(accent()).toBe(groupRoles('default').action)
    unmount()
  })
})
