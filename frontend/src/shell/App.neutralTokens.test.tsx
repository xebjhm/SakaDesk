import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { useAppStore } from '../store/appStore'
import { persisted } from '../core/persistence/persisted'
import { groupRoles } from '../design/tokens'

const accent = () => document.documentElement.style.getPropertyValue('--ds-group-accent')

// Spec D2d decision 3: neutral `default` tokens until ToS is accepted and a group is chosen.
describe('group tokens before a group is chosen', () => {
  beforeEach(() => {
    vi.spyOn(persisted, 'getPref').mockImplementation(<T,>(key: string, fallback: T): T => {
      if (key === 'tos_accepted_at') return '2024-01-01T00:00:00Z' as unknown as T
      if (key === 'language') return 'en' as unknown as T
      return fallback
    })
  })

  it('the landing page is neutral even when a removed group was active; a chosen group applies', async () => {
    useAppStore.setState({ selectedServices: [], activeService: 'sakurazaka46' })
    render(<AuthProvider><App /></AuthProvider>)
    expect(await screen.findByText(/Welcome to SakaDesk|landing\.welcome/)).toBeInTheDocument()
    expect(accent()).toBe(groupRoles('default').action)

    act(() => { useAppStore.setState({ selectedServices: ['sakurazaka46'], activeService: 'sakurazaka46' }) })
    await vi.waitFor(() => expect(accent()).toBe(groupRoles('sakurazaka').action))
  })
})
