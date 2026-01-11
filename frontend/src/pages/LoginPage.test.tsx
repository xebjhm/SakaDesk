import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginPage } from './LoginPage'

describe('LoginPage component', () => {
  const defaultProps = {
    onLoginSuccess: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(global.fetch).mockReset()
  })

  it('should render login button', () => {
    render(<LoginPage {...defaultProps} />)
    expect(screen.getByRole('button', { name: /Launch Browser Login/i })).toBeInTheDocument()
  })

  it('should render title and description', () => {
    render(<LoginPage {...defaultProps} />)
    expect(screen.getByRole('heading', { name: /Connect Account/i })).toBeInTheDocument()
    expect(screen.getByText(/Please log in to your Hinatazaka46/i)).toBeInTheDocument()
  })

  it('should call onLoginSuccess when login succeeds', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response)

    render(<LoginPage {...defaultProps} />)

    const loginButton = screen.getByRole('button', { name: /Launch Browser Login/i })
    await userEvent.click(loginButton)

    await waitFor(() => {
      expect(defaultProps.onLoginSuccess).toHaveBeenCalled()
    })
  })

  it('should show loading state while logging in', async () => {
    // Make fetch hang indefinitely
    vi.mocked(global.fetch).mockImplementation(() => new Promise(() => {}))

    render(<LoginPage {...defaultProps} />)

    const loginButton = screen.getByRole('button', { name: /Launch Browser Login/i })
    await userEvent.click(loginButton)

    expect(screen.getByText(/Waiting for browser/i)).toBeInTheDocument()
  })

  it('should display error message on login failure', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'))

    render(<LoginPage {...defaultProps} />)

    const loginButton = screen.getByRole('button', { name: /Launch Browser Login/i })
    await userEvent.click(loginButton)

    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeInTheDocument()
    })
  })

  it('should display error when response is not ok', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
    } as Response)

    render(<LoginPage {...defaultProps} />)

    const loginButton = screen.getByRole('button', { name: /Launch Browser Login/i })
    await userEvent.click(loginButton)

    await waitFor(() => {
      expect(screen.getByText(/Login failed or cancelled/i)).toBeInTheDocument()
    })
  })

  it('should display initial error if provided', () => {
    render(<LoginPage {...defaultProps} initialError="Session expired" />)
    expect(screen.getByText(/Session expired/i)).toBeInTheDocument()
  })

  it('should disable button while loading', async () => {
    vi.mocked(global.fetch).mockImplementation(() => new Promise(() => {}))

    render(<LoginPage {...defaultProps} />)

    const loginButton = screen.getByRole('button', { name: /Launch Browser Login/i })
    await userEvent.click(loginButton)

    const loadingButton = screen.getByRole('button')
    expect(loadingButton).toBeDisabled()
  })

  it('should render security notice', () => {
    render(<LoginPage {...defaultProps} />)
    expect(screen.getByText(/Your credentials are saved locally/i)).toBeInTheDocument()
  })
})
