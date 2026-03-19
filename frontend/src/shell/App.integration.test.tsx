import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { useAppStore } from '../store/appStore'

// Helper to render App with required providers
const renderApp = () => {
  return render(
    <AuthProvider>
      <App />
    </AuthProvider>
  )
}

describe('App Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock localStorage: ToS accepted, language set
    vi.mocked(localStorage.getItem).mockImplementation((key: string) => {
      if (key === 'tos_accepted_at') return '2024-01-01T00:00:00Z'
      if (key === 'zakadesk-language') return 'en'
      return null
    })
    // Set up Zustand store with a selected service so we skip the landing page
    useAppStore.setState({
      selectedServices: ['hinatazaka46'],
      activeService: 'hinatazaka46',
    })
  })

  it('should render main app when authenticated', async () => {
    renderApp()

    // Wait for auth check and initial render - look for i18n key fallback or English text
    await waitFor(() => {
      expect(screen.getByText(/Select a Conversation|messages\.selectConversation/)).toBeInTheDocument()
    })
  })

  it('should show welcome message when no conversation selected', async () => {
    renderApp()

    await waitFor(() => {
      expect(screen.getByText(/Welcome to SakaDesk|messages\.welcome/)).toBeInTheDocument()
    })
  })

  it('should display sidebar with groups from API', async () => {
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Test Member')).toBeInTheDocument()
    })
  })

  it('should load messages when conversation is selected', async () => {
    renderApp()

    // Wait for sidebar to load
    await waitFor(() => {
      expect(screen.getByText('Test Member')).toBeInTheDocument()
    })

    // Click on the conversation
    await userEvent.click(screen.getByText('Test Member'))

    // Wait for chat to load - Virtuoso renders with visibility:hidden in jsdom
    // so we verify the chat area is present and the unread count is shown
    await waitFor(() => {
      // Header should show the conversation name
      const header = screen.getByRole('banner')
      expect(within(header).getByText('Test Member')).toBeInTheDocument()
      // Unread badge should appear indicating messages were fetched
      expect(screen.getByText(/unread/)).toBeInTheDocument()
    })

    // Verify Virtuoso container is rendered (messages area exists)
    expect(screen.getByTestId('virtuoso-scroller')).toBeInTheDocument()
  })

  it('should show header with conversation name after selection', async () => {
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Test Member')).toBeInTheDocument()
    })

    // Use getAllByText and click the first (sidebar) occurrence
    const testMemberElements = screen.getAllByText('Test Member')
    await userEvent.click(testMemberElements[0])

    // Header should update with conversation name
    await waitFor(() => {
      const header = screen.getByRole('banner')
      expect(within(header).getByText('Test Member')).toBeInTheDocument()
    })
  })
})
