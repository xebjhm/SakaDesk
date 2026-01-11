import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChatScroll } from './useChatScroll'
import type { Message } from '../types'

// Create a minimal message for testing
const createMessage = (id: number): Message => ({
  id,
  timestamp: '2024-01-15T10:00:00Z',
  type: 'text',
  is_favorite: false,
  content: `Message ${id}`,
  media_file: null,
  width: null,
  height: null,
})

describe('useChatScroll hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(localStorage.getItem).mockReturnValue(null)
    vi.mocked(localStorage.setItem).mockClear()
  })

  it('should return expected shape', () => {
    const messages = [createMessage(1), createMessage(2), createMessage(3)]

    const { result } = renderHook(() =>
      useChatScroll('room-1', messages)
    )

    expect(typeof result.current.initialTopMostItemIndex).toBe('number')
    expect(typeof result.current.handleRangeChanged).toBe('function')
    expect(typeof result.current.savePositionImmediate).toBe('function')
  })

  it('should default to last index when no saved position', () => {
    const messages = [createMessage(1), createMessage(2), createMessage(3)]

    const { result } = renderHook(() =>
      useChatScroll('room-1', messages)
    )

    // Should start at bottom (last index = 2)
    expect(result.current.initialTopMostItemIndex).toBe(2)
  })

  it('should restore position from localStorage on mount', () => {
    const messages = [createMessage(101), createMessage(102), createMessage(103)]

    // Mock saved position for message ID 102
    vi.mocked(localStorage.getItem).mockReturnValue('102')

    const { result } = renderHook(() =>
      useChatScroll('room-1', messages)
    )

    // Should start at index 1 (where id=102 is)
    expect(result.current.initialTopMostItemIndex).toBe(1)
  })

  it('should fall back to bottom when saved ID not found', () => {
    const messages = [createMessage(1), createMessage(2), createMessage(3)]

    // Mock saved position with ID that doesn't exist in messages
    vi.mocked(localStorage.getItem).mockReturnValue('999')

    const { result } = renderHook(() =>
      useChatScroll('room-1', messages)
    )

    // Should fall back to bottom (last index)
    expect(result.current.initialTopMostItemIndex).toBe(2)
  })

  it('should use different localStorage keys for different rooms', () => {
    const messages = [createMessage(1)]

    renderHook(() => useChatScroll('room-A', messages))

    expect(localStorage.getItem).toHaveBeenCalledWith('hakodesk_scroll_room-A')
  })

  it('should save position immediately when savePositionImmediate is called', () => {
    const messages = [createMessage(101), createMessage(102), createMessage(103)]

    const { result } = renderHook(() =>
      useChatScroll('room-1', messages)
    )

    // Simulate scrolling to index 1
    act(() => {
      result.current.handleRangeChanged({ startIndex: 1, endIndex: 2 })
    })

    // Then save immediately
    act(() => {
      result.current.savePositionImmediate()
    })

    expect(localStorage.setItem).toHaveBeenCalledWith('hakodesk_scroll_room-1', '102')
  })

  it('should handle empty messages array', () => {
    const { result } = renderHook(() =>
      useChatScroll('room-1', [])
    )

    expect(result.current.initialTopMostItemIndex).toBe(0)
  })
})
