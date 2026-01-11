import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

describe('App Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(localStorage.getItem).mockReturnValue(null)
  })

  it('should render main app when authenticated', async () => {
    render(<App />)

    // Wait for auth check and initial render
    await waitFor(() => {
      expect(screen.getByText('Select a Conversation')).toBeInTheDocument()
    })
  })

  it('should show welcome message when no conversation selected', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/Welcome to HakoDesk/)).toBeInTheDocument()
    })
  })

  it('should display sidebar with groups from API', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Test Member')).toBeInTheDocument()
    })
  })

  it('should load messages when conversation is selected', async () => {
    render(<App />)

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
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Test Member')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('Test Member'))

    // Header should update with conversation name
    await waitFor(() => {
      const header = screen.getByRole('banner')
      expect(within(header).getByText('Test Member')).toBeInTheDocument()
    })
  })
})
