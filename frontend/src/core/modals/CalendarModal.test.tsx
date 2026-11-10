import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import { server } from '../../__tests__/mocks/server'
import { CalendarModal } from './CalendarModal'
import type { Message } from '../../types'

// Frozen clock: the calendar opens on June 2026 in every test, so the visible month and the
// snapshots do not depend on the day the suite runs. Only Date is faked (msw and userEvent
// keep real timers).
const YEAR = 2026
const MONTH = '06'
const DAY_15 = `${YEAR}-${MONTH}-15`

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(YEAR, 5, 10, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
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

      // The indicator is delayed by the 200 ms reveal (no flash on fast loads).
      await waitFor(() => expect(document.querySelector('.animate-spin')).toBeInTheDocument())
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
        expect(screen.getByText('Could not load the dates')).toBeInTheDocument()
      })
    })

    it('should call onSelectDate with date string when date clicked (API mode)', async () => {
      const user = userEvent.setup()
      const onSelectDate = vi.fn()

      const testDate = DAY_15

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

      const testDate = DAY_15

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
    // Test dates in the frozen month
    const getTestMessagesWithMedia = () => {
      const year = YEAR
      const month = MONTH

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
      const year = YEAR
      const month = MONTH

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
      const testDate = DAY_15

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
      // Use getAllByText since '14' might appear in multiple places (e.g., month header)
      const day14Elements = screen.getAllByText('14')
      // Find the one that's inside a button (calendar day cell)
      const day14Span = day14Elements.find(el => el.closest('button') !== null)
      expect(day14Span).toBeDefined()
      const day14Button = day14Span!.closest('button')
      expect(day14Button).toBeDisabled()

      // Day 15 span's parent button should be enabled (has messages)
      const day15Span = screen.getByText('15')
      const day15Button = day15Span.closest('button')
      expect(day15Button).not.toBeDisabled()
    })

    it('should show indicator dot on dates with messages', async () => {
      const testDate = DAY_15

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
      const indicatorDot = day15Button?.querySelector('span[aria-hidden="true"]')
      expect(indicatorDot).toBeInTheDocument()
    })
  })

  describe('Day tooltip', () => {
    it('gives a day its translated item count', async () => {
      setupApiHandler([{ date: DAY_15, count: 5 }, { date: `${YEAR}-${MONTH}-20`, count: 1 }])
      render(<CalendarModal isOpen onClose={defaultCloseHandler} conversationPath="/test/path" onSelectDate={vi.fn()} />)
      await waitFor(() => expect(screen.getByText('Available on 2 days')).toBeInTheDocument())
      // The count is the day's dark tooltip (hover / focus) and its accessible description.
      const day = (n: string) => screen.getByText(n).closest('button')!
      expect(day('15')).toHaveAccessibleDescription('5 items')
      expect(within(day('15')).getByRole('tooltip', { hidden: true })).toHaveTextContent('5 items')
      expect(day('20')).toHaveAccessibleDescription('1 item')
      expect(within(day('14')).queryByRole('tooltip', { hidden: true })).toBeNull()
      expect(day('15')).not.toHaveAttribute('title')
    })
  })

  // Role-based structure checks (the dialog is portaled, so a container snapshot was empty).
  describe('Structure', () => {
    const dayButtons = () =>
      screen.getAllByRole('button').filter(b => b.hasAttribute('data-day'))

    it('API mode: a named dialog showing the frozen month, with only the dated days enabled', async () => {
      setupApiHandler([
        { date: `${YEAR}-${MONTH}-15`, count: 5 },
        { date: `${YEAR}-${MONTH}-20`, count: 3 },
      ])
      render(<CalendarModal isOpen onClose={defaultCloseHandler} conversationPath="/test/path" onSelectDate={vi.fn()} />)
      await waitFor(() => expect(screen.getByText('Available on 2 days')).toBeInTheDocument())

      const dialog = screen.getByRole('dialog', { name: 'Date Search' })
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(screen.getByText('June 2026')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument()
      expect(dayButtons().filter(b => !(b as HTMLButtonElement).disabled).map(b => b.getAttribute('data-day'))).toEqual(['15', '20'])
    })

    it('Messages mode: the custom title names the dialog and the media days are enabled', async () => {
      const messages = [
        createMessage({ id: 1, timestamp: `${YEAR}-${MONTH}-15T10:00:00Z`, media_file: 'photo.jpg', type: 'picture' }),
        createMessage({ id: 2, timestamp: `${YEAR}-${MONTH}-20T10:00:00Z`, media_file: 'video.mp4', type: 'video' }),
      ]
      render(<CalendarModal isOpen onClose={defaultCloseHandler} messages={messages} onSelectDate={vi.fn()} title="Jump to Date" />)
      await waitFor(() => expect(screen.getByText('Available on 2 days')).toBeInTheDocument())

      expect(screen.getByRole('dialog', { name: 'Jump to Date' })).toBeInTheDocument()
      expect(dayButtons().filter(b => !(b as HTMLButtonElement).disabled).map(b => b.getAttribute('data-day'))).toEqual(['15', '20'])
    })
  })

  describe('Any-day dates mode', () => {
    it('lets every day be picked without showing a count', async () => {
      const onSelectDate = vi.fn()
      render(<CalendarModal isOpen onClose={vi.fn()} dates={[]} selectAnyDay onSelectDate={onSelectDate} />)
      const day = document.querySelector<HTMLButtonElement>('button[data-day="3"]:not([data-outside])')!
      expect(day).not.toBeDisabled()
      expect(day).not.toHaveAttribute('aria-describedby')
      await userEvent.click(day)
      const picked = onSelectDate.mock.calls[0][0] as Date
      expect([picked.getFullYear(), picked.getMonth(), picked.getDate()]).toEqual([YEAR, 5, 3])
    })

    it('opens on the initial month each time', async () => {
      const { rerender } = render(<CalendarModal isOpen onClose={vi.fn()} dates={[]} selectAnyDay initialMonth={new Date(YEAR, 8, 14)} onSelectDate={vi.fn()} />)
      expect(screen.getByRole('button', { name: /September 2026/ })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /next month/i }))
      rerender(<CalendarModal isOpen={false} onClose={vi.fn()} dates={[]} selectAnyDay initialMonth={new Date(YEAR, 8, 14)} onSelectDate={vi.fn()} />)
      rerender(<CalendarModal isOpen onClose={vi.fn()} dates={[]} selectAnyDay initialMonth={new Date(YEAR, 8, 14)} onSelectDate={vi.fn()} />)
      expect(screen.getByRole('button', { name: /September 2026/ })).toBeInTheDocument()
    })

    it('shows every picker month as available, without the no-messages hint', async () => {
      render(<CalendarModal isOpen onClose={vi.fn()} dates={[]} selectAnyDay onSelectDate={vi.fn()} />)
      await userEvent.click(screen.getByRole('button', { name: /June 2026/ }))
      const grid = screen.getByRole('group', { name: /month/i })
      for (const btn of within(grid).getAllByRole('button')) {
        if (btn.getAttribute('aria-pressed') === 'true') continue
        expect(btn.className).toContain('text-primary')
        expect(btn.textContent).not.toMatch(/no messages/i)
      }
    })

    it('keeps days without dates disabled by default', () => {
      render(<CalendarModal isOpen onClose={vi.fn()} dates={[]} onSelectDate={vi.fn()} />)
      expect(document.querySelector('button[data-day="3"]:not([data-outside])')).toBeDisabled()
    })
  })
})
