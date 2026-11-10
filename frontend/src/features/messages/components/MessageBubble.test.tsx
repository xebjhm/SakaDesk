import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../__tests__/mocks/server'
import { MessageBubble } from './MessageBubble'
import { useAppStore } from '../../../store/appStore'
import type { Message } from '../../../types'

// The translation and transcription hooks read their backend caches on mount: both are empty.
beforeEach(() => {
  server.use(
    http.get('/api/app-state/translations', () => HttpResponse.json({})),
    http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })),
  )
})

// Fix timezone to UTC for deterministic snapshot output
const originalTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'UTC' })
afterAll(() => { process.env.TZ = originalTZ })

const createMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 1,
  content: 'Hello world',
  timestamp: '2024-01-15T10:30:00Z',
  type: 'text',
  is_favorite: false,
  media_file: undefined,
  width: undefined,
  height: undefined,
  ...overrides,
})

describe('MessageBubble component', () => {
  const defaultProps = {
    message: createMessage(),
    member_name: 'Test User',
    member_avatar: '/avatar.jpg',
    isUnread: false,
    onReveal: vi.fn(),
    onLongPress: vi.fn(),
    service: '日向坂46',  // Required for media URL construction
  }

  it('should render text message content', () => {
    render(<MessageBubble {...defaultProps} />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('should render sender name', () => {
    render(<MessageBubble {...defaultProps} />)
    expect(screen.getByText('Test User')).toBeInTheDocument()
  })

  it('should render timestamp in expected format', () => {
    render(<MessageBubble {...defaultProps} />)
    expect(screen.getByText('10:30')).toBeInTheDocument()
  })

  it('should render avatar image when provided', () => {
    render(<MessageBubble {...defaultProps} />)
    const avatar = screen.getByRole('img', { name: 'Test User' })
    expect(avatar).toHaveAttribute('src', '/avatar.jpg')
  })

  it('without onAvatarClick the avatar is a plain, non-focusable span of the same box', () => {
    // Room-author (member 0) messages pass no handler: no button, no pointer, no hover ring, no tab stop.
    render(<MessageBubble {...defaultProps} />)
    const avatar = screen.getByTestId('message-avatar')
    expect(avatar.tagName).toBe('SPAN')
    expect(avatar).toContainElement(screen.getByRole('img', { name: 'Test User' }))
    expect(avatar).toHaveClass('flex', 'rounded-pill')
    expect(avatar).not.toHaveAttribute('tabindex')
    expect(avatar.className).not.toContain('cursor-pointer')
    expect(avatar.className).not.toContain('hover:ring-accent-border')
    expect(screen.queryByRole('button', { name: /Test User/ })).toBeNull()
    expect(avatar.closest('button')).toBeNull()
  })

  it('with onAvatarClick the avatar is a clickable, focusable button', async () => {
    const onAvatarClick = vi.fn()
    render(<MessageBubble {...defaultProps} onAvatarClick={onAvatarClick} />)
    const button = screen.getByTestId('message-avatar')
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toContainElement(screen.getByRole('img', { name: 'Test User' }))
    expect(button.className).toContain('cursor-pointer')
    expect(button.className).toContain('hover:ring-accent-border')
    await userEvent.click(button)
    expect(onAvatarClick).toHaveBeenCalledTimes(1)
    button.focus()
    expect(button).toHaveFocus()
  })

  it('sizes the avatar button to the avatar and gives it a round focus ring', () => {
    render(<MessageBubble {...defaultProps} onAvatarClick={vi.fn()} />)
    const button = screen.getByRole('img', { name: 'Test User' }).closest('button')!
    expect(button).toHaveClass('flex', 'rounded-pill', 'focus-visible:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-accent', 'focus-visible:ring-offset-2', 'focus-visible:ring-offset-surface')
  })

  it('should render initials when no avatar provided', () => {
    render(<MessageBubble {...defaultProps} member_avatar={undefined} />)
    expect(screen.getByText('T')).toBeInTheDocument()
  })

  it('should show shelter overlay when isUnread is true', () => {
    render(<MessageBubble {...defaultProps} isUnread={true} />)
    // When unread, the content should be hidden (opacity-0) but overlay shows an icon
    const overlay = document.querySelector('.absolute.inset-0')
    expect(overlay).toBeInTheDocument()
  })

  it('should call onReveal when unread overlay is clicked', async () => {
    const onReveal = vi.fn()
    render(<MessageBubble {...defaultProps} isUnread={true} onReveal={onReveal} />)

    const overlay = document.querySelector('.absolute.inset-0.z-10')
    expect(overlay).toBeInTheDocument()

    if (overlay) {
      await userEvent.click(overlay)
      expect(onReveal).toHaveBeenCalled()
    }
  })

  it('should render picture message with image', () => {
    const pictureMessage = createMessage({
      type: 'picture',
      media_file: 'path/to/photo.jpg',
      width: 800,
      height: 600,
    })
    render(<MessageBubble {...defaultProps} message={pictureMessage} />)

    const images = screen.getAllByRole('img')
    // Should have avatar + media image
    const mediaImage = images.find(img => img.getAttribute('src')?.includes('photo.jpg'))
    expect(mediaImage).toBeInTheDocument()
  })

  describe('opt-in media props (Memories read-only lists)', () => {
    const picture = createMessage({ type: 'picture', media_file: 'messages/1/picture/2.jpg', width: 800, height: 600 })
    const FULL = '/api/content/media/%E6%97%A5%E5%90%91%E5%9D%8246/messages/1/picture/2.jpg'
    const THUMB = '/api/content/thumb/%E6%97%A5%E5%90%91%E5%9D%8246/messages/1/picture/2.jpg?w=640'

    it('keeps the chat default: the full file, loaded eagerly', () => {
      render(<MessageBubble {...defaultProps} message={picture} />)
      const img = screen.getByAltText('Attachment')
      expect(img).toHaveAttribute('src', FULL)
      expect(img).toHaveAttribute('loading', 'eager')
    })

    it('draws a lazy thumbnail, falls back to the full file and hands the viewer the full file', () => {
      const onMediaClick = vi.fn()
      render(
        <MessageBubble {...defaultProps} message={picture} mediaLoading="lazy" mediaThumbWidth={640} onMediaClick={onMediaClick} />,
      )
      const img = screen.getByAltText('Attachment')
      expect(img).toHaveAttribute('src', THUMB)
      expect(img).toHaveAttribute('loading', 'lazy')
      fireEvent.click(img)
      expect(onMediaClick).toHaveBeenCalledWith(FULL, 'picture', picture.timestamp)
      fireEvent.error(img)
      expect(screen.getByAltText('Attachment')).toHaveAttribute('src', FULL)
    })
  })

  it('should linkify URLs in text content', () => {
    const messageWithUrl = createMessage({
      content: 'Check out https://example.com for more info',
    })
    render(<MessageBubble {...defaultProps} message={messageWithUrl} />)

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('should render video message with video element', () => {
    const videoMessage = createMessage({
      type: 'video',
      media_file: 'path/to/video.mp4',
      width: 1920,
      height: 1080,
    })
    const { container } = render(<MessageBubble {...defaultProps} message={videoMessage} />)

    const video = container.querySelector('video')
    expect(video).toBeInTheDocument()
    expect(video?.getAttribute('src')).toContain('video.mp4')
  })

  it.each([
    ['video', 'video'],
    ['voice', 'audio'],
  ] as const)('keys the %s player by media URL, so its state resets when the source changes', (type, tag) => {
    const msg = (file: string) => createMessage({ type, media_file: file, content: null })
    const { container, rerender } = render(<MessageBubble {...defaultProps} message={msg('path/to/a.mp4')} />)
    const first = container.querySelector(tag)!
    expect(first.getAttribute('src')).toContain('a.mp4')
    // Same URL: the same player (and element) stays mounted.
    rerender(<MessageBubble {...defaultProps} message={msg('path/to/a.mp4')} />)
    expect(container.querySelector(tag)).toBe(first)
    // A new URL mounts a fresh player: a new element, not the old one re-pointed.
    rerender(<MessageBubble {...defaultProps} message={msg('path/to/b.mp4')} />)
    const second = container.querySelector(tag)!
    expect(second).not.toBe(first)
    expect(second.getAttribute('src')).toContain('b.mp4')
    expect(first.isConnected).toBe(false)
  })

  it('should render fallback when no content or media', () => {
    const emptyMessage = createMessage({
      content: undefined,
      media_file: undefined,
    })
    render(<MessageBubble {...defaultProps} message={emptyMessage} />)

    expect(screen.getByText('(No content)')).toBeInTheDocument()
  })

  it('should handle voice message type', () => {
    const voiceMessage = createMessage({
      type: 'voice',
      media_file: 'path/to/voice.mp3',
      content: null,
    })
    const { container } = render(<MessageBubble {...defaultProps} message={voiceMessage} />)

    // VoicePlayer component should be rendered
    // It contains playback controls
    const voiceContainer = container.querySelector('.rounded-lg')
    expect(voiceContainer).toBeInTheDocument()
  })

  it('should encode special characters in media URLs', () => {
    const messageWithSpecialPath = createMessage({
      type: 'picture',
      media_file: 'path/to/my photo.jpg',
    })
    render(<MessageBubble {...defaultProps} message={messageWithSpecialPath} />)

    const images = screen.getAllByRole('img')
    const mediaImage = images.find(img => img.getAttribute('src')?.includes('my%20photo.jpg'))
    expect(mediaImage).toBeInTheDocument()
  })

  it('a later bubble of a run hides avatar and name and shows its time on hover', () => {
    render(<MessageBubble {...defaultProps} runStart={false} />)
    expect(screen.queryByText('Test User')).toBeNull()
    expect(screen.queryByRole('img', { name: 'Test User' })).toBeNull()
    expect(screen.getByText('10:30')).toHaveClass('opacity-0', 'group-hover/row:opacity-100')
  })

  it('only the first bubble of a run keeps the small top-left corner', () => {
    const { container, rerender } = render(<MessageBubble {...defaultProps} />)
    expect(container.querySelector('.border-group-bubble')).toHaveClass('rounded-card', 'rounded-tl-tail', 'shadow-card')
    rerender(<MessageBubble {...defaultProps} runStart={false} />)
    expect(container.querySelector('.border-group-bubble')).toHaveClass('rounded-card')
    expect(container.querySelector('.border-group-bubble')).not.toHaveClass('rounded-tl-tail')
  })

  it('draws the favourite star in the accent colour', () => {
    const { container } = render(<MessageBubble {...defaultProps} message={createMessage({ is_favorite: true })} />)
    expect(container.querySelector('svg.h-3\\.5')).toHaveClass('fill-current', 'text-semantic-star', 'drop-shadow-sm')
  })

  it('marks the text and the member name as Japanese content', () => {
    render(<MessageBubble {...defaultProps} message={createMessage({ content: 'おはよう🌸' })} />)
    expect(screen.getByText('おはよう🌸').closest('[lang="ja"]')).not.toBeNull()
    expect(screen.getByText('Test User')).toHaveAttribute('lang', 'ja')
  })

  it('links use the strong accent role (4.5:1) and underline on hover', () => {
    render(<MessageBubble {...defaultProps} message={createMessage({ content: 'see https://example.com' })} />)
    const link = screen.getByRole('link', { name: 'https://example.com' })
    expect(link).toHaveClass('text-accent-strong', 'hover:underline')
    expect(link).not.toHaveClass('text-accent')
  })

  describe('translate icon', () => {
    afterEach(() => { useAppStore.setState({ translationEnabled: false }) })
    const trailing = (c: HTMLElement) => c.querySelector('[data-testid="message-trailing"]') as HTMLElement

    it('run start: one icon-only neutral button in the trailing column, not in the header', () => {
      useAppStore.setState({ translationEnabled: true })
      const { container } = render(<MessageBubble {...defaultProps} />)
      const buttons = screen.getAllByRole('button', { name: 'Translate' })
      expect(buttons).toHaveLength(1)
      expect(trailing(container)).toContainElement(buttons[0])
      expect(buttons[0].textContent).toBe('')
      expect(buttons[0]).toHaveClass('text-secondary', 'hover:text-primary')
      expect(buttons[0]).toHaveAttribute('title', 'Translate')
      expect(screen.getByText('10:30').parentElement).not.toContainElement(buttons[0])
    })

    it('continuation: the same button sits in the trailing column with the time', () => {
      useAppStore.setState({ translationEnabled: true })
      const { container } = render(<MessageBubble {...defaultProps} runStart={false} />)
      const button = screen.getByRole('button', { name: 'Translate' })
      expect(trailing(container)).toContainElement(button)
      expect(trailing(container)).toContainElement(screen.getByText('10:30'))
    })

    it('reveals on row hover and on keyboard focus, not hover alone', () => {
      useAppStore.setState({ translationEnabled: true })
      render(<MessageBubble {...defaultProps} />)
      const wrapper = screen.getByRole('button', { name: 'Translate' }).parentElement!.parentElement as HTMLElement
      expect(wrapper).toHaveClass('opacity-0', 'group-hover/row:opacity-100', 'focus-within:opacity-100', 'group-focus-within/row:opacity-100')
    })

    it('the trailing column is out of flow so the bubble never reflows or loses width', () => {
      useAppStore.setState({ translationEnabled: true })
      const { container } = render(<MessageBubble {...defaultProps} />)
      expect(trailing(container)).toHaveClass('absolute', 'left-full', 'bottom-0')
      expect(trailing(container)).not.toHaveClass('shrink-0')
      // Anchored to the bubble column, which keeps its max width regardless of the icon
      expect(trailing(container).parentElement).toHaveClass('relative', 'max-w-[80%]')
    })

    it('renders no trailing column when there is nothing to put in it', () => {
      const { container } = render(<MessageBubble {...defaultProps} />)
      expect(trailing(container)).toBeNull()
    })
  })

  describe('voice transcript footer', () => {
    const voice = createMessage({ type: 'voice', content: null, media_file: 'v.m4a' })
    const footerOf = (c: HTMLElement) => c.querySelector('[data-testid="transcript-footer"]') as HTMLElement

    afterEach(() => { useAppStore.setState({ transcriptionEnabled: false }) })

    it('joins the bubble: square bottom corners, footer carries the radius, no negative margin', () => {
      useAppStore.setState({ transcriptionEnabled: true })
      const { container } = render(<MessageBubble {...defaultProps} message={voice} />)
      expect(container.querySelector('.border-group-bubble')).toHaveClass('rounded-card', 'rounded-b-none')
      const footer = footerOf(container)
      expect(footer).toHaveClass('rounded-b-card', 'border-x', 'border-b')
      expect(footer.className).not.toMatch(/-mt-/)
    })

    it('squares the voice player bottom corners when a footer is attached, keeping the top', () => {
      useAppStore.setState({ transcriptionEnabled: true })
      const { container } = render(<MessageBubble {...defaultProps} message={voice} />)
      const player = container.querySelector('.min-w-\\[300px\\]') as HTMLElement
      expect(player).toHaveClass('rounded-lg', 'rounded-b-none')
    })

    it('a run-start voice player carries the bubble tail corner; a later one does not', () => {
      const { container, rerender } = render(<MessageBubble {...defaultProps} message={voice} />)
      expect(container.querySelector('.min-w-\\[300px\\]')).toHaveClass('rounded-tl-tail')
      rerender(<MessageBubble {...defaultProps} message={voice} runStart={false} />)
      expect(container.querySelector('.min-w-\\[300px\\]')).not.toHaveClass('rounded-tl-tail')
    })

    it('a run-start voice player with a footer has tail corner, square bottom and rounded-lg together', () => {
      useAppStore.setState({ transcriptionEnabled: true })
      const { container } = render(<MessageBubble {...defaultProps} message={voice} />)
      expect(container.querySelector('.min-w-\\[300px\\]')).toHaveClass('rounded-tl-tail', 'rounded-b-none', 'rounded-lg')
    })

    it('keeps the voice player fully rounded without a footer', () => {
      const { container } = render(<MessageBubble {...defaultProps} message={voice} />)
      expect(container.querySelector('.min-w-\\[300px\\]')).not.toHaveClass('rounded-b-none')
    })

    it('keeps the bubble fully rounded without a footer and while unread', () => {
      const { container, rerender } = render(<MessageBubble {...defaultProps} message={voice} />)
      expect(container.querySelector('.border-group-bubble')).not.toHaveClass('rounded-b-none')
      useAppStore.setState({ transcriptionEnabled: true })
      rerender(<MessageBubble {...defaultProps} message={voice} isUnread />)
      expect(footerOf(container)).toBeNull()
      expect(container.querySelector('.border-group-bubble')).not.toHaveClass('rounded-b-none')
      expect(screen.getByTestId('unread-shelter')).toHaveClass('rounded-card')
      expect(screen.getByTestId('unread-shelter')).not.toHaveClass('rounded-b-none')
    })
  })

  it('the unread shelter uses the official shelter colour of the message type', () => {
    render(<MessageBubble {...defaultProps} isUnread message={createMessage({ type: 'voice', content: null })} />)
    const shelter = screen.getByTestId('unread-shelter')
    expect(shelter).toHaveClass('bg-group-shelter-voice', 'text-inverse')
    expect(shelter.getAttribute('style')).toBeNull()
  })

  it('a light-shelter group (Sakurazaka) shows the unread shelter as a bordered white card', () => {
    render(<MessageBubble {...defaultProps} service="sakurazaka46" isUnread message={createMessage({ type: 'voice', content: null })} />)
    expect(screen.getByTestId('unread-shelter')).toHaveClass(
      'border-2', 'border-group-shelter-voice', 'bg-card', 'text-group-shelter-voice',
    )
  })

  it('names the sender with the strong accent role', () => {
    render(<MessageBubble {...defaultProps} />)
    expect(screen.getByText('Test User')).toHaveClass('text-accent-strong')
  })

  describe('Snapshots', () => {
    it('should match snapshot for text message', () => {
      const { container } = render(<MessageBubble {...defaultProps} />)
      expect(container.firstChild).toMatchSnapshot()
    })

    it('should match snapshot for picture message', () => {
      const pictureMessage = createMessage({
        type: 'picture',
        media_file: 'path/to/photo.jpg',
        width: 800,
        height: 600,
      })
      const { container } = render(<MessageBubble {...defaultProps} message={pictureMessage} />)
      expect(container.firstChild).toMatchSnapshot()
    })

    it('should match snapshot for unread message with overlay', () => {
      const { container } = render(<MessageBubble {...defaultProps} isUnread={true} />)
      expect(container.firstChild).toMatchSnapshot()
    })
  })

  it('draws the unread shelter icon at full opacity', () => {
    render(<MessageBubble {...defaultProps} isUnread={true} />)
    expect(screen.getByTestId('unread-shelter').querySelector('svg')?.getAttribute('class')).not.toMatch(/opacity/)
  })
})

describe('MessageBubble read-only and time zone (Memories)', () => {
  const props = { message: createMessage(), member_name: 'Test User', service: 'hinatazaka46' }

  it('opens the favourite menu on right-click by default', () => {
    render(<MessageBubble {...props} />)
    fireEvent.contextMenu(screen.getByText('Hello world'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('opens no menu when read-only', () => {
    render(<MessageBubble {...props} readOnly />)
    fireEvent.contextMenu(screen.getByText('Hello world'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it.each([
    { readOnly: false, menus: 1 },
    { readOnly: true, menus: 0 },
  ])('a long press opens $menus menu(s) when readOnly=$readOnly', ({ readOnly, menus }) => {
    vi.useFakeTimers()
    try {
      render(<MessageBubble {...props} readOnly={readOnly} />)
      fireEvent.touchStart(screen.getByText('Hello world'), { touches: [{ clientX: 1, clientY: 1 }] })
      act(() => { vi.advanceTimersByTime(700) })
      expect(screen.queryAllByRole('menu')).toHaveLength(menus)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the time in the given zone instead of the local clock', () => {
    // 2024-01-15 00:30 JST is 15:30 UTC the day before (the suite runs in UTC).
    render(<MessageBubble {...props} message={createMessage({ timestamp: '2024-01-14T15:30:00Z' })} timeZone="Asia/Tokyo" />)
    expect(screen.getByText('00:30')).toBeInTheDocument()
    expect(screen.queryByText('15:30')).toBeNull()
  })
})
