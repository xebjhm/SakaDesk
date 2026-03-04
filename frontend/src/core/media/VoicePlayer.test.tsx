import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VoicePlayer } from './VoicePlayer'
import { useAppStore } from '../../store/appStore'

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Mock HTMLMediaElement
beforeEach(() => {
  vi.clearAllMocks()
  localStorageMock.getItem.mockReturnValue(null)

  // Mock audio element methods
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
  window.HTMLMediaElement.prototype.load = vi.fn()
})

describe('VoicePlayer component', () => {
  const defaultProps = {
    src: '/api/media/voice.m4a',
  }

  describe('Compact variant (default)', () => {
    it('should render compact player by default', () => {
      const { container } = render(<VoicePlayer {...defaultProps} />)
      // Compact variant has min-w-[300px]
      const player = container.querySelector('.min-w-\\[300px\\]')
      expect(player).toBeInTheDocument()
    })

    it('should render play button', () => {
      const { container } = render(<VoicePlayer {...defaultProps} />)
      // Find the main play button - it's the one with w-10 h-10 rounded-full (center play button)
      const playButton = container.querySelector('button.w-10.h-10.rounded-full')
      expect(playButton).toBeInTheDocument()
    })

    it('should render audio element with correct src', () => {
      const { container } = render(<VoicePlayer {...defaultProps} />)
      const audio = container.querySelector('audio')
      expect(audio).toHaveAttribute('src', '/api/media/voice.m4a')
      expect(audio).toHaveAttribute('preload', 'metadata')
    })

    it('should render volume control', () => {
      const { container } = render(<VoicePlayer {...defaultProps} />)
      const volumeSlider = container.querySelector('input[type="range"][max="1"]')
      expect(volumeSlider).toBeInTheDocument()
    })

    it('should render progress bar', () => {
      const { container } = render(<VoicePlayer {...defaultProps} />)
      const progressBar = container.querySelector('input[type="range"][max="100"]')
      expect(progressBar).toBeInTheDocument()
    })

    it('should render menu button', () => {
      const { container } = render(<VoicePlayer {...defaultProps} />)
      // MoreVertical icon button
      const menuButtons = container.querySelectorAll('button')
      expect(menuButtons.length).toBeGreaterThan(0)
    })

    it('should display time initially', () => {
      render(<VoicePlayer {...defaultProps} />)
      // Time displays as 0:00 / 0:00 when duration is 0 (metadata not loaded)
      expect(screen.getByText(/0:00/)).toBeInTheDocument()
    })
  })

  describe('Premium variant', () => {
    const premiumProps = {
      ...defaultProps,
      variant: 'premium' as const,
      avatarUrl: '/avatar.jpg',
      memberName: 'Test User',
      timestamp: '2024/06/15 14:30',
      durationText: '01:45',
    }

    it('should render premium player with glassmorphism styling', () => {
      const { container } = render(<VoicePlayer {...premiumProps} />)
      // Premium variant uses backdrop-blur-xl
      const player = container.querySelector('.backdrop-blur-xl')
      expect(player).toBeInTheDocument()
    })

    it('should render avatar image when provided', () => {
      const { container } = render(<VoicePlayer {...premiumProps} />)
      const avatar = container.querySelector('img')
      expect(avatar).toHaveAttribute('src', '/avatar.jpg')
    })

    it('should render member name', () => {
      render(<VoicePlayer {...premiumProps} />)
      expect(screen.getByText('Test User')).toBeInTheDocument()
    })

    it('should render timestamp and duration', () => {
      render(<VoicePlayer {...premiumProps} />)
      // Timestamp and duration are in the same line with a separator
      expect(screen.getByText(/2024\/06\/15 14:30/)).toBeInTheDocument()
      expect(screen.getByText(/01:45/)).toBeInTheDocument()
    })

    it('should render skip buttons in premium variant', () => {
      render(<VoicePlayer {...premiumProps} />)
      // Skip buttons show "5" text for 5-second skip
      const skipLabels = screen.getAllByText('5')
      expect(skipLabels).toHaveLength(2)
    })

    it('should render fallback initial when no avatar', () => {
      render(<VoicePlayer {...premiumProps} avatarUrl={undefined} />)
      expect(screen.getByText('T')).toBeInTheDocument() // First char of "Test User"
    })

    it('should render colored progress bar', () => {
      const { container } = render(<VoicePlayer {...premiumProps} />)
      // Progress bar uses inline backgroundColor style (accentColor prop)
      const progressBar = container.querySelector('.bg-gray-200\\/60 > div.rounded-full')
      expect(progressBar).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should toggle play/pause on button click', async () => {
      const user = userEvent.setup()
      const { container } = render(<VoicePlayer {...defaultProps} />)

      // Find the play button - it's the one with w-10 h-10 rounded-full (center play button)
      const playButton = container.querySelector('button.w-10.h-10.rounded-full')
      expect(playButton).toBeInTheDocument()

      if (playButton) {
        await user.click(playButton)
        expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled()
      }
    })

    it('should show menu when menu button is clicked', async () => {
      // Enable golden finger so Download button appears
      useAppStore.setState({ goldenFingerActive: true })
      const user = userEvent.setup()
      render(<VoicePlayer {...defaultProps} />)

      // Find the menu button (last button in the player)
      const menuButton = screen.getAllByRole('button').pop()
      expect(menuButton).toBeInTheDocument()

      if (menuButton) {
        await user.click(menuButton)
        // Menu should show Download option and speed options
        expect(screen.getByText('Download')).toBeInTheDocument()
        expect(screen.getByText('Speed')).toBeInTheDocument()
      }
    })

    it('should restore volume from localStorage', () => {
      localStorageMock.getItem.mockReturnValue('0.5')
      const { container } = render(<VoicePlayer {...defaultProps} />)

      const volumeSlider = container.querySelector('input[type="range"][max="1"]') as HTMLInputElement
      expect(volumeSlider?.value).toBe('0.5')
    })
  })

  describe('Snapshots', () => {
    it('should match snapshot for compact variant', () => {
      const { container } = render(<VoicePlayer {...defaultProps} />)
      expect(container.firstChild).toMatchSnapshot()
    })

    it('should match snapshot for premium variant', () => {
      const { container } = render(
        <VoicePlayer
          {...defaultProps}
          variant="premium"
          avatarUrl="/avatar.jpg"
          memberName="Test User"
          timestamp="2024/06/15 14:30"
          durationText="01:45"
        />
      )
      expect(container.firstChild).toMatchSnapshot()
    })

    it('should match snapshot for premium variant without avatar', () => {
      const { container } = render(
        <VoicePlayer
          {...defaultProps}
          variant="premium"
          memberName="Test User"
          timestamp="2024/06/15 14:30"
        />
      )
      expect(container.firstChild).toMatchSnapshot()
    })
  })
})
