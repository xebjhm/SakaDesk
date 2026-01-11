import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageBubble } from './MessageBubble'
import type { Message } from '../types'

const createMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 1,
  content: 'Hello world',
  timestamp: '2024-01-15T10:30:00Z',
  type: 'text',
  is_favorite: false,
  media_file: null,
  width: null,
  height: null,
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
    // Timestamp format: YYYY/MM/DD HH:MM (time may vary based on timezone)
    expect(screen.getByText(/2024\/01\/15 \d{2}:\d{2}/)).toBeInTheDocument()
  })

  it('should render avatar image when provided', () => {
    render(<MessageBubble {...defaultProps} />)
    const avatar = screen.getByRole('img', { name: 'Test User' })
    expect(avatar).toHaveAttribute('src', '/avatar.jpg')
  })

  it('should render initials when no avatar provided', () => {
    render(<MessageBubble {...defaultProps} member_avatar={undefined} />)
    // Should show first 2 chars of name
    expect(screen.getByText('Te')).toBeInTheDocument()
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

  it('should render fallback when no content or media', () => {
    const emptyMessage = createMessage({
      content: null,
      media_file: null,
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
    const voiceContainer = container.querySelector('.rounded-2xl')
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
})
