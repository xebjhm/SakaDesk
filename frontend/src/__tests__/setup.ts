import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, afterAll, beforeAll, vi } from 'vitest'
import { server } from './mocks/server'

// Start MSW server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

// Reset handlers after each test
afterEach(() => {
  cleanup()
  server.resetHandlers()
})

// Clean up after all tests
afterAll(() => server.close())

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

// Mock HTMLMediaElement methods for audio/video tests
HTMLMediaElement.prototype.load = vi.fn()
HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
HTMLMediaElement.prototype.pause = vi.fn()

// Mock Web Audio API (not available in jsdom)
class MockAudioContext {
  destination = {}
  state = 'running'
  createMediaElementSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }))
  createGain = vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }))
  close = vi.fn()
}
globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext
