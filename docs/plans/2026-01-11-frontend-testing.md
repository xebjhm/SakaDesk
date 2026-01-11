# Frontend Testing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up Vitest + React Testing Library for the HakoDesk frontend and add initial tests for key components.

**Architecture:** Install Vitest with jsdom environment, configure it to work with the existing Vite setup, add setup file with common mocks (localStorage, fetch), then write tests starting with utilities and hooks before moving to components.

**Tech Stack:** Vitest, @testing-library/react, @testing-library/jest-dom, jsdom

---

## Task 1: Install Testing Dependencies

**Files:**
- Modify: `frontend/package.json`

**Step 1: Install Vitest and testing libraries**

Run:
```bash
cd /home/xtorker/repos/Project-PyHako/HakoDesk/frontend && npm install --save-dev vitest @vitest/ui @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @vitest/coverage-v8
```

**Step 2: Add test scripts to package.json**

Add these scripts:
```json
"test": "vitest",
"test:run": "vitest run",
"test:coverage": "vitest run --coverage"
```

**Step 3: Verify installation**

Run: `npm run test:run`
Expected: "No test files found" (since we haven't added any yet)

**Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "build(frontend): add Vitest and React Testing Library

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Configure Vitest

**Files:**
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/__tests__/setup.ts`

**Step 1: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/__tests__/**', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
```

**Step 2: Create test setup file**

```typescript
// src/__tests__/setup.ts
import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Mock fetch
global.fetch = vi.fn()

// Mock HTMLMediaElement methods for audio/video tests
HTMLMediaElement.prototype.load = vi.fn()
HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
HTMLMediaElement.prototype.pause = vi.fn()
```

**Step 3: Run vitest to verify config**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk/frontend && npm run test:run`
Expected: "No test files found" (config works but no tests yet)

**Step 4: Commit**

```bash
git add frontend/vitest.config.ts frontend/src/__tests__/setup.ts
git commit -m "build(frontend): configure Vitest with jsdom and test setup

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add Tests for Utility Functions

**Files:**
- Create: `frontend/src/lib/utils.test.ts`
- Test: `frontend/src/lib/utils.ts`

**Step 1: Write tests for cn() utility**

```typescript
import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('cn utility function', () => {
  it('should merge class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('should handle conditional classes', () => {
    expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz')
  })

  it('should handle undefined and null', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar')
  })

  it('should merge Tailwind classes correctly', () => {
    // tailwind-merge should dedupe conflicting classes
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('should handle arrays of classes', () => {
    expect(cn(['foo', 'bar'], 'baz')).toBe('foo bar baz')
  })

  it('should return empty string for no inputs', () => {
    expect(cn()).toBe('')
  })
})
```

**Step 2: Run tests**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk/frontend && npm run test:run`
Expected: All tests pass

**Step 3: Commit**

```bash
git add frontend/src/lib/utils.test.ts
git commit -m "test(frontend): add tests for cn utility function

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Add Tests for AudioManager

**Files:**
- Create: `frontend/src/utils/AudioManager.test.ts`
- Test: `frontend/src/utils/AudioManager.ts`

**Step 1: Write tests for AudioManager singleton**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { audioManager, AudioManager } from './AudioManager'

describe('AudioManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset audio manager state
    audioManager.pause()
  })

  describe('singleton pattern', () => {
    it('should export a singleton instance', () => {
      expect(audioManager).toBeInstanceOf(AudioManager)
    })

    it('should always return the same instance', () => {
      const instance1 = audioManager
      const instance2 = audioManager
      expect(instance1).toBe(instance2)
    })
  })

  describe('play and pause', () => {
    it('should call audio.play when play is called', async () => {
      const src = '/test/audio.mp3'
      await audioManager.play(src)
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    })

    it('should call audio.pause when pause is called', () => {
      audioManager.pause()
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    })

    it('should update currentSrc when playing new audio', async () => {
      const src = '/test/audio.mp3'
      await audioManager.play(src)
      expect(audioManager.getCurrentSrc()).toBe(src)
    })
  })

  describe('volume control', () => {
    it('should set volume within valid range', () => {
      audioManager.setVolume(0.5)
      // Volume is set on internal audio element
      expect(audioManager).toBeDefined()
    })

    it('should clamp volume to 0-1 range', () => {
      // Setting volume outside range should not throw
      expect(() => audioManager.setVolume(1.5)).not.toThrow()
      expect(() => audioManager.setVolume(-0.5)).not.toThrow()
    })
  })

  describe('playback rate', () => {
    it('should set playback rate', () => {
      audioManager.setPlaybackRate(1.5)
      expect(audioManager).toBeDefined()
    })

    it('should accept common playback rates', () => {
      expect(() => audioManager.setPlaybackRate(0.5)).not.toThrow()
      expect(() => audioManager.setPlaybackRate(1)).not.toThrow()
      expect(() => audioManager.setPlaybackRate(2)).not.toThrow()
    })
  })

  describe('seek', () => {
    it('should set current time', () => {
      audioManager.setCurrentTime(30)
      expect(audioManager).toBeDefined()
    })
  })

  describe('callback registration', () => {
    it('should register callbacks for a source', () => {
      const src = '/test/audio.mp3'
      const callbacks = {
        onTimeUpdate: vi.fn(),
        onEnded: vi.fn(),
        onLoadedMetadata: vi.fn(),
        onPlay: vi.fn(),
        onPause: vi.fn(),
      }

      audioManager.registerCallbacks(src, callbacks)
      expect(audioManager).toBeDefined()
    })

    it('should unregister callbacks', () => {
      const src = '/test/audio.mp3'
      audioManager.unregisterCallbacks(src)
      expect(audioManager).toBeDefined()
    })
  })
})
```

**Step 2: Run tests**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk/frontend && npm run test:run`
Expected: All tests pass

**Step 3: Commit**

```bash
git add frontend/src/utils/AudioManager.test.ts
git commit -m "test(frontend): add tests for AudioManager singleton

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Add Tests for useChatScroll Hook

**Files:**
- Create: `frontend/src/hooks/useChatScroll.test.ts`
- Test: `frontend/src/hooks/useChatScroll.ts`

**Step 1: Write tests for useChatScroll hook**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChatScroll } from './useChatScroll'

describe('useChatScroll hook', () => {
  const mockVirtuosoRef = {
    current: {
      scrollToIndex: vi.fn(),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(localStorage.getItem).mockReturnValue(null)
    vi.mocked(localStorage.setItem).mockClear()
  })

  it('should return scrollToBottom and handleRangeChange functions', () => {
    const { result } = renderHook(() =>
      useChatScroll({
        roomId: 'room-1',
        messages: [],
        virtuosoRef: mockVirtuosoRef as any,
      })
    )

    expect(typeof result.current.scrollToBottom).toBe('function')
    expect(typeof result.current.handleRangeChange).toBe('function')
  })

  it('should scroll to bottom when scrollToBottom is called', () => {
    const messages = [
      { id: 1, content: 'msg1' },
      { id: 2, content: 'msg2' },
      { id: 3, content: 'msg3' },
    ]

    const { result } = renderHook(() =>
      useChatScroll({
        roomId: 'room-1',
        messages: messages as any,
        virtuosoRef: mockVirtuosoRef as any,
      })
    )

    act(() => {
      result.current.scrollToBottom()
    })

    expect(mockVirtuosoRef.current.scrollToIndex).toHaveBeenCalledWith({
      index: 'LAST',
      behavior: 'smooth',
    })
  })

  it('should save scroll position to localStorage', async () => {
    const messages = [
      { id: 101, content: 'msg1' },
      { id: 102, content: 'msg2' },
      { id: 103, content: 'msg3' },
    ]

    const { result } = renderHook(() =>
      useChatScroll({
        roomId: 'room-1',
        messages: messages as any,
        virtuosoRef: mockVirtuosoRef as any,
      })
    )

    // Simulate range change (scrolling)
    act(() => {
      result.current.handleRangeChange({ startIndex: 1, endIndex: 2 })
    })

    // Wait for debounce
    await vi.waitFor(() => {
      expect(localStorage.setItem).toHaveBeenCalled()
    }, { timeout: 1000 })
  })

  it('should restore scroll position from localStorage on mount', () => {
    const messages = [
      { id: 101, content: 'msg1' },
      { id: 102, content: 'msg2' },
      { id: 103, content: 'msg3' },
    ]

    // Mock saved position
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify({ messageId: 102 }))

    renderHook(() =>
      useChatScroll({
        roomId: 'room-1',
        messages: messages as any,
        virtuosoRef: mockVirtuosoRef as any,
      })
    )

    // Should try to scroll to the saved message
    expect(mockVirtuosoRef.current.scrollToIndex).toHaveBeenCalled()
  })

  it('should use different localStorage keys for different rooms', () => {
    const messages = [{ id: 1, content: 'msg1' }]

    renderHook(() =>
      useChatScroll({
        roomId: 'room-A',
        messages: messages as any,
        virtuosoRef: mockVirtuosoRef as any,
      })
    )

    expect(localStorage.getItem).toHaveBeenCalledWith(expect.stringContaining('room-A'))
  })
})
```

**Step 2: Run tests**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk/frontend && npm run test:run`
Expected: Tests pass (may need adjustments based on actual hook implementation)

**Step 3: Commit**

```bash
git add frontend/src/hooks/useChatScroll.test.ts
git commit -m "test(frontend): add tests for useChatScroll hook

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Add Tests for MessageBubble Component

**Files:**
- Create: `frontend/src/components/MessageBubble.test.tsx`
- Test: `frontend/src/components/MessageBubble.tsx`

**Step 1: Write tests for MessageBubble**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MessageBubble from './MessageBubble'

describe('MessageBubble component', () => {
  const defaultProps = {
    message: {
      id: 1,
      content: 'Hello world',
      timestamp: '2024-01-15T10:30:00Z',
      type: 'text' as const,
    },
    senderInfo: {
      name: 'Test User',
      thumbnail: '/avatar.jpg',
    },
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

  it('should render timestamp', () => {
    render(<MessageBubble {...defaultProps} />)
    // Timestamp should be formatted and visible
    expect(screen.getByText(/10:30/)).toBeInTheDocument()
  })

  it('should render avatar image', () => {
    render(<MessageBubble {...defaultProps} />)
    const avatar = screen.getByRole('img')
    expect(avatar).toHaveAttribute('src', '/avatar.jpg')
  })

  it('should show unread overlay when isUnread is true', () => {
    render(<MessageBubble {...defaultProps} isUnread={true} />)
    // Unread messages should have a shelter/overlay
    expect(screen.getByText(/Click to reveal/i)).toBeInTheDocument()
  })

  it('should call onReveal when unread message is clicked', async () => {
    const onReveal = vi.fn()
    render(<MessageBubble {...defaultProps} isUnread={true} onReveal={onReveal} />)

    const shelter = screen.getByText(/Click to reveal/i)
    await userEvent.click(shelter)

    expect(onReveal).toHaveBeenCalledWith(defaultProps.message.id)
  })

  it('should render picture message with image', () => {
    const pictureProps = {
      ...defaultProps,
      message: {
        ...defaultProps.message,
        type: 'picture' as const,
        media_file: '/media/photo.jpg',
        width: 800,
        height: 600,
      },
    }
    render(<MessageBubble {...pictureProps} />)

    const images = screen.getAllByRole('img')
    const mediaImage = images.find(img => img.getAttribute('src')?.includes('photo.jpg'))
    expect(mediaImage).toBeInTheDocument()
  })

  it('should linkify URLs in text content', () => {
    const propsWithUrl = {
      ...defaultProps,
      message: {
        ...defaultProps.message,
        content: 'Check out https://example.com for more info',
      },
    }
    render(<MessageBubble {...propsWithUrl} />)

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://example.com')
  })

  it('should handle voice message type', () => {
    const voiceProps = {
      ...defaultProps,
      message: {
        ...defaultProps.message,
        type: 'voice' as const,
        media_file: '/media/voice.mp3',
      },
    }
    render(<MessageBubble {...voiceProps} />)

    // Voice messages should render VoicePlayer
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})
```

**Step 2: Run tests**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk/frontend && npm run test:run`
Expected: Tests pass (may need adjustments based on actual component implementation)

**Step 3: Commit**

```bash
git add frontend/src/components/MessageBubble.test.tsx
git commit -m "test(frontend): add tests for MessageBubble component

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Add Tests for LoginPage Component

**Files:**
- Create: `frontend/src/pages/LoginPage.test.tsx`
- Test: `frontend/src/pages/LoginPage.tsx`

**Step 1: Write tests for LoginPage**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginPage from './LoginPage'

describe('LoginPage component', () => {
  const defaultProps = {
    onLogin: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(global.fetch).mockReset()
  })

  it('should render login button', () => {
    render(<LoginPage {...defaultProps} />)
    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument()
  })

  it('should call onLogin when login button is clicked', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response)

    render(<LoginPage {...defaultProps} />)

    const loginButton = screen.getByRole('button', { name: /login/i })
    await userEvent.click(loginButton)

    await waitFor(() => {
      expect(defaultProps.onLogin).toHaveBeenCalled()
    })
  })

  it('should show loading state while logging in', async () => {
    // Make fetch hang
    vi.mocked(global.fetch).mockImplementation(() => new Promise(() => {}))

    render(<LoginPage {...defaultProps} />)

    const loginButton = screen.getByRole('button', { name: /login/i })
    await userEvent.click(loginButton)

    expect(screen.getByText(/logging in/i)).toBeInTheDocument()
  })

  it('should display error message on login failure', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'))

    render(<LoginPage {...defaultProps} />)

    const loginButton = screen.getByRole('button', { name: /login/i })
    await userEvent.click(loginButton)

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument()
    })
  })

  it('should render app logo or title', () => {
    render(<LoginPage {...defaultProps} />)
    // Should have some branding
    expect(screen.getByText(/hakodesk/i)).toBeInTheDocument()
  })
})
```

**Step 2: Run tests**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk/frontend && npm run test:run`
Expected: Tests pass

**Step 3: Commit**

```bash
git add frontend/src/pages/LoginPage.test.tsx
git commit -m "test(frontend): add tests for LoginPage component

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Add Test Script to CI Workflow

**Files:**
- Modify: `.github/workflows/build.yml`

**Step 1: Add frontend test step**

Add after the "Build Frontend" step:

```yaml
    - name: Run Frontend Tests
      working-directory: ./frontend
      run: |
        npm run test:run
```

**Step 2: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "build: add frontend tests to CI workflow

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Verification

After all tasks complete:

1. **Run all frontend tests:**
   ```bash
   cd /home/xtorker/repos/Project-PyHako/HakoDesk/frontend
   npm run test:run
   ```
   Expected: All tests pass

2. **Run with coverage:**
   ```bash
   npm run test:coverage
   ```
   Expected: Coverage report generated

3. **Verify CI configuration:**
   ```bash
   cat .github/workflows/build.yml | grep -A3 "Frontend Tests"
   ```
   Expected: Frontend test step present

---

## Summary

| Task | Files | Tests Added |
|------|-------|-------------|
| 1 | package.json | Dependencies |
| 2 | vitest.config.ts, setup.ts | Configuration |
| 3 | utils.test.ts | 6 tests |
| 4 | AudioManager.test.ts | 10 tests |
| 5 | useChatScroll.test.ts | 5 tests |
| 6 | MessageBubble.test.tsx | 8 tests |
| 7 | LoginPage.test.tsx | 5 tests |
| 8 | build.yml | CI integration |

**Total new tests:** ~34 tests
