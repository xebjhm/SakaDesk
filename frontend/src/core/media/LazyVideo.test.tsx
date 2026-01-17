import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LazyVideo } from './LazyVideo'

// Mock IntersectionObserver
const mockObserve = vi.fn()
const mockUnobserve = vi.fn()
const mockDisconnect = vi.fn()

let intersectionCallback: IntersectionObserverCallback | null = null
let observerOptions: IntersectionObserverInit | undefined = undefined

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin: string = ''
  readonly thresholds: ReadonlyArray<number> = []

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    intersectionCallback = callback
    observerOptions = options
  }

  observe = mockObserve
  unobserve = mockUnobserve
  disconnect = mockDisconnect
  takeRecords = vi.fn(() => [])
}

beforeEach(() => {
  vi.clearAllMocks()
  intersectionCallback = null
  observerOptions = undefined
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Helper to simulate intersection (wrapped in act for state updates)
const simulateIntersection = (isIntersecting: boolean) => {
  act(() => {
    if (intersectionCallback) {
      intersectionCallback(
        [{ isIntersecting } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    }
  })
}

describe('LazyVideo component', () => {
  const defaultProps = {
    src: '/api/media/video.mp4',
  }

  describe('Lazy loading behavior', () => {
    it('should render placeholder initially', () => {
      const { container } = render(<LazyVideo {...defaultProps} />)

      // Should show Film icon placeholder
      const placeholder = container.querySelector('.absolute.inset-0')
      expect(placeholder).toBeInTheDocument()

      // Video should not be rendered until visible
      const video = container.querySelector('video')
      expect(video).not.toBeInTheDocument()
    })

    it('should observe container with IntersectionObserver', () => {
      render(<LazyVideo {...defaultProps} />)

      expect(mockObserve).toHaveBeenCalledTimes(1)
    })

    it('should use rootMargin for early loading', () => {
      render(<LazyVideo {...defaultProps} />)

      expect(observerOptions).toEqual(
        expect.objectContaining({
          rootMargin: '100px',
          threshold: 0,
        })
      )
    })

    it('should render video when element becomes visible', () => {
      const { container } = render(<LazyVideo {...defaultProps} />)

      // Initially no video
      expect(container.querySelector('video')).not.toBeInTheDocument()

      // Simulate intersection
      simulateIntersection(true)

      // Video should now be rendered
      const video = container.querySelector('video')
      expect(video).toBeInTheDocument()
      expect(video).toHaveAttribute('src', '/api/media/video.mp4')
    })

    it('should unobserve after becoming visible', () => {
      render(<LazyVideo {...defaultProps} />)

      simulateIntersection(true)

      expect(mockUnobserve).toHaveBeenCalledTimes(1)
    })

    it('should disconnect observer on unmount', () => {
      const { unmount } = render(<LazyVideo {...defaultProps} />)

      unmount()

      expect(mockDisconnect).toHaveBeenCalledTimes(1)
    })
  })

  describe('Video element', () => {
    it('should have preload="metadata" attribute', () => {
      const { container } = render(<LazyVideo {...defaultProps} />)

      simulateIntersection(true)

      const video = container.querySelector('video')
      expect(video).toHaveAttribute('preload', 'metadata')
    })

    it('should have object-cover styling', () => {
      const { container } = render(<LazyVideo {...defaultProps} />)

      simulateIntersection(true)

      const video = container.querySelector('video')
      expect(video?.className).toContain('object-cover')
    })
  })

  describe('Loading transition', () => {
    it('should fade in video after metadata loads', () => {
      const { container } = render(<LazyVideo {...defaultProps} />)

      simulateIntersection(true)

      const video = container.querySelector('video')
      expect(video).toBeInTheDocument()
      expect(video?.className).toContain('opacity-0')

      // Simulate video loaded
      act(() => {
        if (video) {
          fireEvent.loadedData(video)
        }
      })

      // Video should now be visible
      expect(video?.className).toContain('opacity-100')
    })

    it('should hide placeholder after video loads', () => {
      const { container } = render(<LazyVideo {...defaultProps} />)

      simulateIntersection(true)

      const video = container.querySelector('video')
      const placeholder = container.querySelector('.absolute.inset-0.flex')

      // Before load - placeholder visible
      expect(placeholder?.className).toContain('opacity-100')

      // Simulate video loaded
      act(() => {
        if (video) {
          fireEvent.loadedData(video)
        }
      })

      // After load - placeholder hidden
      expect(placeholder?.className).toContain('opacity-0')
    })
  })

  describe('Click handling', () => {
    it('should call onClick when clicked', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()

      render(<LazyVideo {...defaultProps} onClick={onClick} />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('should render as button element', () => {
      render(<LazyVideo {...defaultProps} />)

      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })
  })

  describe('Children rendering', () => {
    it('should render overlay children', () => {
      render(
        <LazyVideo {...defaultProps}>
          <span data-testid="overlay">Overlay content</span>
        </LazyVideo>
      )

      expect(screen.getByTestId('overlay')).toBeInTheDocument()
      expect(screen.getByText('Overlay content')).toBeInTheDocument()
    })

    it('should render children regardless of video load state', () => {
      const { container } = render(
        <LazyVideo {...defaultProps}>
          <span data-testid="badge">Duration badge</span>
        </LazyVideo>
      )

      // Children visible before intersection
      expect(screen.getByTestId('badge')).toBeInTheDocument()

      // Simulate intersection and video load
      simulateIntersection(true)
      const video = container.querySelector('video')
      act(() => {
        if (video) {
          fireEvent.loadedData(video)
        }
      })

      // Children still visible after load
      expect(screen.getByTestId('badge')).toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <LazyVideo {...defaultProps} className="custom-class w-32 h-32" />
      )

      const button = container.querySelector('button')
      expect(button?.className).toContain('custom-class')
      expect(button?.className).toContain('w-32')
      expect(button?.className).toContain('h-32')
    })

    it('should have bg-gray-200 placeholder background', () => {
      const { container } = render(<LazyVideo {...defaultProps} />)

      const button = container.querySelector('button')
      expect(button?.className).toContain('bg-gray-200')
    })

    it('should have overflow-hidden for clean video display', () => {
      const { container } = render(<LazyVideo {...defaultProps} />)

      const button = container.querySelector('button')
      expect(button?.className).toContain('overflow-hidden')
    })
  })

  describe('Snapshots', () => {
    it('should match snapshot before intersection', () => {
      const { container } = render(<LazyVideo {...defaultProps} />)
      expect(container.firstChild).toMatchSnapshot()
    })

    it('should match snapshot after intersection but before load', () => {
      const { container } = render(<LazyVideo {...defaultProps} />)

      simulateIntersection(true)

      expect(container.firstChild).toMatchSnapshot()
    })

    it('should match snapshot when fully loaded', () => {
      const { container } = render(<LazyVideo {...defaultProps} />)

      simulateIntersection(true)

      const video = container.querySelector('video')
      act(() => {
        if (video) {
          fireEvent.loadedData(video)
        }
      })

      expect(container.firstChild).toMatchSnapshot()
    })

    it('should match snapshot with children overlay', () => {
      const { container } = render(
        <LazyVideo {...defaultProps} className="w-48 h-36">
          <div className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1 rounded">
            01:23
          </div>
        </LazyVideo>
      )

      expect(container.firstChild).toMatchSnapshot()
    })
  })
})
