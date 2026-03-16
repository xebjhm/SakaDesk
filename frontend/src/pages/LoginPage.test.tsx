import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import { server } from '../__tests__/mocks/server'
import { LoginPage } from './LoginPage'

describe('LoginPage component', () => {
  const defaultProps = {
    service: 'hinatazaka46',
    onLoginSuccess: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render login button', () => {
    render(<LoginPage {...defaultProps} />)
    expect(screen.getByRole('button', { name: /Launch Browser Login/i })).toBeInTheDocument()
  })

  it('should render title and description', () => {
    render(<LoginPage {...defaultProps} />)
    expect(screen.getByRole('heading', { name: /Connect Account/i })).toBeInTheDocument()
    expect(screen.getByText(/Please log in to your hinatazaka46/i)).toBeInTheDocument()
  })

  it('should call onLoginSuccess when login succeeds', async () => {
    server.use(
      http.post('/api/auth/login', () => {
        return HttpResponse.json({ success: true })
      })
    )

    render(<LoginPage {...defaultProps} />)

    const loginButton = screen.getByRole('button', { name: /Launch Browser Login/i })
    await userEvent.click(loginButton)

    await waitFor(() => {
      expect(defaultProps.onLoginSuccess).toHaveBeenCalled()
    })
  })

  it('should show loading state while logging in', async () => {
    server.use(
      http.post('/api/auth/login', async () => {
        await delay('infinite')
        return HttpResponse.json({ success: true })
      })
    )

    render(<LoginPage {...defaultProps} />)

    const loginButton = screen.getByRole('button', { name: /Launch Browser Login/i })
    await userEvent.click(loginButton)

    expect(screen.getByText(/Waiting for browser/i)).toBeInTheDocument()
  })

  it('should display error message on login failure', async () => {
    server.use(
      http.post('/api/auth/login', () => {
        return HttpResponse.error()
      })
    )

    render(<LoginPage {...defaultProps} />)

    const loginButton = screen.getByRole('button', { name: /Launch Browser Login/i })
    await userEvent.click(loginButton)

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch/i)).toBeInTheDocument()
    })
  })

  it('should display error when response is not ok', async () => {
    server.use(
      http.post('/api/auth/login', () => {
        return new HttpResponse(null, { status: 401 })
      })
    )

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
    server.use(
      http.post('/api/auth/login', async () => {
        await delay('infinite')
        return HttpResponse.json({ success: true })
      })
    )

    render(<LoginPage {...defaultProps} />)

    const loginButton = screen.getByRole('button', { name: /Launch Browser Login/i })
    await userEvent.click(loginButton)

    const loadingButton = screen.getByRole('button')
    expect(loadingButton).toBeDisabled()
  })

  it('should render security notice', () => {
    render(<LoginPage {...defaultProps} />)
    expect(screen.getByText(/Your credentials will be securely stored/i)).toBeInTheDocument()
  })

  describe('Snapshots', () => {
    it('should match snapshot for default state', () => {
      const { container } = render(<LoginPage {...defaultProps} />)
      expect(container.firstChild).toMatchSnapshot()
    })

    it('should match snapshot with error state', () => {
      const { container } = render(<LoginPage {...defaultProps} initialError="Session expired" />)
      expect(container.firstChild).toMatchSnapshot()
    })
  })
})
