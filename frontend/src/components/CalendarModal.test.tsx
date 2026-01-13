import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import { server } from '../__tests__/mocks/server'
import { CalendarModal } from './CalendarModal'
import type { Message } from '../types'

beforeEach(() => {
  vi.clearAllMocks()
})

// Helper to create test messages
const createMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 1,
  content: 'Test message',
  timestamp: '2024-06-15T10:30:00Z',
  type: 'text',
  is_favorite: false,
  ...overrides,
})

describe('CalendarModal component', () => {
  const defaultCloseHandler = vi.fn()

  // Setup default handler for API tests
  const setupApiHandler = (dates: { date: string; count: number }[] = []) => {
    server.use(
      http.get('/api/chat/message_dates/:path', () => {
        return HttpResponse.json({ dates })
      })
    )
  }

  describe('Common functionality', () => {
    it('should render modal when isOpen is true', () => {
      setupApiHandler()

      render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          conversationPath="/test/path"
          onSelectDate={vi.fn()}
        />
      )

      expect(screen.getByText('Date Search')).toBeInTheDocument()
    })

    it('should render custom title when provided', () => {
      setupApiHandler()

      render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          conversationPath="/test/path"
          onSelectDate={vi.fn()}
          title="Media Calendar"
        />
      )

      expect(screen.getByText('Media Calendar')).toBeInTheDocument()
    })

    it('should render weekday headers', async () => {
      setupApiHandler()

      render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          conversationPath="/test/path"
          onSelectDate={vi.fn()}
        />
      )

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.getByText('Sun')).toBeInTheDocument()
      })

      expect(screen.getByText('Mon')).toBeInTheDocument()
      expect(screen.getByText('Tue')).toBeInTheDocument()
      expect(screen.getByText('Wed')).toBeInTheDocument()
      expect(screen.getByText('Thu')).toBeInTheDocument()
      expect(screen.getByText('Fri')).toBeInTheDocument()
      expect(screen.getByText('Sat')).toBeInTheDocument()
    })

    it('should render Today button', () => {
      setupApiHandler()

      render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          conversationPath="/test/path"
          onSelectDate={vi.fn()}
        />
      )

      expect(screen.getByText('Today')).toBeInTheDocument()
    })

    it('should navigate to previous month', async () => {
      const user = userEvent.setup()
      setupApiHandler()

      render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          conversationPath="/test/path"
          onSelectDate={vi.fn()}
        />
      )

      // Wait for calendar to load
      await waitFor(() => {
        expect(screen.getByText('Sun')).toBeInTheDocument()
      })

      // Get month name
      const currentMonthText = screen.getByText(/\w+ \d{4}/)
      const initialMonth = currentMonthText.textContent

      // Click previous button (ChevronLeft button - first in the month nav section)
      const navButtons = screen.getAllByRole('button')
      // Find the first button with ChevronLeft (should be the prev month button after close button)
      const prevButton = navButtons.find(btn => btn.querySelector('svg path[d*="m15"]'))
      expect(prevButton).toBeInTheDocument()
      if (prevButton) {
        await user.click(prevButton)
      }

      // Month should change
      await waitFor(() => {
        expect(screen.getByText(/\w+ \d{4}/)).not.toHaveTextContent(initialMonth!)
      })
    })
  })

  describe('API mode', () => {
    it('should fetch dates from API when opened', async () => {
      setupApiHandler([
        { date: '2024-06-15', count: 5 },
        { date: '2024-06-20', count: 3 },
      ])

      render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          conversationPath="/test/path"
          onSelectDate={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Available on 2 days')).toBeInTheDocument()
      })
    })

    it('should show loading state while fetching', async () => {
      // Delay response to keep loading
      server.use(
        http.get('/api/chat/message_dates/:path', async () => {
          await delay('infinite')
          return HttpResponse.json({ dates: [] })
        })
      )

      render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          conversationPath="/test/path"
          onSelectDate={vi.fn()}
        />
      )

      // Loading indicator should be visible
      const loadingElement = document.querySelector('.animate-spin')
      expect(loadingElement).toBeInTheDocument()
    })

    it('should show error state on API failure', async () => {
      server.use(
        http.get('/api/chat/message_dates/:path', () => {
          return HttpResponse.json({ detail: 'API Error' }, { status: 500 })
        })
      )

      render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          conversationPath="/test/path"
          onSelectDate={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByText(/API Error|Failed/i)).toBeInTheDocument()
      })
    })

    it('should call onSelectDate with date string when date clicked (API mode)', async () => {
      const user = userEvent.setup()
      const onSelectDate = vi.fn()

      // Use current month for the test date so the day is visible
      const today = new Date()
      const testDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-15`

      setupApiHandler([{ date: testDate, count: 5 }])

      render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          conversationPath="/test/path"
          onSelectDate={onSelectDate}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Available on 1 days')).toBeInTheDocument()
      })

      // Find and click the day with messages (day 15)
      const day15Button = screen.getByText('15')
      await user.click(day15Button)

      expect(onSelectDate).toHaveBeenCalledWith(testDate)
    })

    it('should close modal after date selection', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      // Use current month for the test date
      const today = new Date()
      const testDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-15`

      setupApiHandler([{ date: testDate, count: 5 }])

      render(
        <CalendarModal
          isOpen={true}
          onClose={onClose}
          conversationPath="/test/path"
          onSelectDate={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Available on 1 days')).toBeInTheDocument()
      })

      const day15Button = screen.getByText('15')
      await user.click(day15Button)

      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('Messages mode', () => {
    // Generate test dates based on current month
    const getTestMessagesWithMedia = () => {
      const today = new Date()
      const year = today.getFullYear()
      const month = String(today.getMonth() + 1).padStart(2, '0')

      return [
        createMessage({ id: 1, timestamp: `${year}-${month}-15T10:00:00Z`, media_file: 'photo1.jpg', type: 'picture' }),
        createMessage({ id: 2, timestamp: `${year}-${month}-15T14:00:00Z`, media_file: 'photo2.jpg', type: 'picture' }),
        createMessage({ id: 3, timestamp: `${year}-${month}-20T09:00:00Z`, media_file: 'video.mp4', type: 'video' }),
        createMessage({ id: 4, timestamp: `${year}-${month}-20T10:00:00Z` }), // No media - should not count
      ]
    }

    it('should compute dates from messages array', async () => {
      render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          messages={getTestMessagesWithMedia()}
          onSelectDate={vi.fn()}
        />
      )

      // Should show 2 days with media (15th and 20th)
      await waitFor(() => {
        expect(screen.getByText('Available on 2 days')).toBeInTheDocument()
      })
    })

    it('should not fetch from API in messages mode', () => {
      // No API handler setup, would throw if fetch is called
      render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          messages={getTestMessagesWithMedia()}
          onSelectDate={vi.fn()}
        />
      )

      // If we get here without error, no API call was made
      expect(screen.getByText('Date Search')).toBeInTheDocument()
    })

    it('should call onSelectDate with Date object when date clicked (Messages mode)', async () => {
      const user = userEvent.setup()
      const onSelectDate = vi.fn()

      render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          messages={getTestMessagesWithMedia()}
          onSelectDate={onSelectDate}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Available on 2 days')).toBeInTheDocument()
      })

      // Find and click day 15
      const day15Button = screen.getByText('15')
      await user.click(day15Button)

      // Should receive Date object in messages mode
      expect(onSelectDate).toHaveBeenCalled()
      const calledArg = onSelectDate.mock.calls[0][0]
      expect(calledArg).toBeInstanceOf(Date)
      expect(calledArg.getDate()).toBe(15)
    })

    it('should only count messages with media_file', async () => {
      const today = new Date()
      const year = today.getFullYear()
      const month = String(today.getMonth() + 1).padStart(2, '0')

      const mixedMessages = [
        createMessage({ id: 1, timestamp: `${year}-${month}-15T10:00:00Z`, media_file: 'photo.jpg', type: 'picture' }),
        createMessage({ id: 2, timestamp: `${year}-${month}-16T10:00:00Z` }), // No media
        createMessage({ id: 3, timestamp: `${year}-${month}-17T10:00:00Z`, media_file: undefined }), // Explicit undefined
      ]

      render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          messages={mixedMessages}
          onSelectDate={vi.fn()}
        />
      )

      // Should only show 1 day (15th has media)
      await waitFor(() => {
        expect(screen.getByText('Available on 1 days')).toBeInTheDocument()
      })
    })

    it('should handle empty messages array', async () => {
      render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          messages={[]}
          onSelectDate={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Tap a date to jump')).toBeInTheDocument()
      })
    })
  })

  describe('Date indicators', () => {
    it('should disable dates without messages', async () => {
      // Use current month for test date
      const today = new Date()
      const testDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-15`

      setupApiHandler([{ date: testDate, count: 5 }])

      render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          conversationPath="/test/path"
          onSelectDate={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Available on 1 days')).toBeInTheDocument()
      })

      // Day 14 span's parent button should be disabled (no messages)
      const day14Span = screen.getByText('14')
      const day14Button = day14Span.closest('button')
      expect(day14Button).toBeDisabled()

      // Day 15 span's parent button should be enabled (has messages)
      const day15Span = screen.getByText('15')
      const day15Button = day15Span.closest('button')
      expect(day15Button).not.toBeDisabled()
    })

    it('should show indicator dot on dates with messages', async () => {
      // Use current month for test date
      const today = new Date()
      const testDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-15`

      setupApiHandler([{ date: testDate, count: 5 }])

      render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          conversationPath="/test/path"
          onSelectDate={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Available on 1 days')).toBeInTheDocument()
      })

      // Find day 15 button which has messages - it should contain the indicator dot
      const day15Span = screen.getByText('15')
      const day15Button = day15Span.closest('button')

      // The button with messages should have the indicator dot element inside it
      const indicatorDot = day15Button?.querySelector('.bg-blue-500')
      expect(indicatorDot).toBeInTheDocument()
    })
  })

  describe('Snapshots', () => {
    it('should match snapshot in API mode', async () => {
      // Use current month
      const today = new Date()
      const year = today.getFullYear()
      const month = String(today.getMonth() + 1).padStart(2, '0')

      setupApiHandler([
        { date: `${year}-${month}-15`, count: 5 },
        { date: `${year}-${month}-20`, count: 3 },
      ])

      const { container } = render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          conversationPath="/test/path"
          onSelectDate={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Available on 2 days')).toBeInTheDocument()
      })

      expect(container.firstChild).toMatchSnapshot()
    })

    it('should match snapshot in Messages mode', async () => {
      // Use current month for messages
      const today = new Date()
      const year = today.getFullYear()
      const month = String(today.getMonth() + 1).padStart(2, '0')

      const messages = [
        createMessage({ id: 1, timestamp: `${year}-${month}-15T10:00:00Z`, media_file: 'photo.jpg', type: 'picture' }),
        createMessage({ id: 2, timestamp: `${year}-${month}-20T10:00:00Z`, media_file: 'video.mp4', type: 'video' }),
      ]

      const { container } = render(
        <CalendarModal
          isOpen={true}
          onClose={defaultCloseHandler}
          messages={messages}
          onSelectDate={vi.fn()}
          title="Jump to Date"
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Available on 2 days')).toBeInTheDocument()
      })

      expect(container.firstChild).toMatchSnapshot()
    })
  })
})
