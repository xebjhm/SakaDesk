import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useLayoutEffect } from 'react'
import { renderHook, act } from '@testing-library/react'
import type { ListRange } from 'react-virtuoso'
import { useChatScroll } from './useChatScroll'
import type { Message } from '../../../types'
import type { Letter } from '../letters'
import { buildTimeline } from '../timeline/buildTimeline'
import { persisted } from '../../../core/persistence/persisted'

const T0 = Date.UTC(2024, 0, 15, 10, 0)
const message = (id: number): Message => ({
  id, timestamp: new Date(T0 + id * 60_000).toISOString(), type: 'text', is_favorite: false, content: `Message ${id}`,
})
const letter = (id: number, minutes: number): Letter => ({
  id, text: '', created_at: new Date(T0 + minutes * 60_000).toISOString(), image_url: null, width: null, height: null,
})
const timelineOf = (ids: number[], letters: Letter[] = []) => buildTimeline(ids.map(message), letters)

describe('useChatScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    vi.spyOn(persisted, 'getConv').mockReturnValue({})
    vi.spyOn(persisted, 'setConv').mockImplementation(() => {})
    vi.spyOn(persisted, 'setConvBeacon').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('opens a new room at the last row', () => {
    const { result } = renderHook(() => useChatScroll('room-1', timelineOf([1, 2, 3])))
    expect(result.current.initialTopMostItemIndex).toBe(2)
  })

  it('restores the saved message by id', () => {
    vi.mocked(persisted.getConv).mockReturnValue({ value: '102' })
    const { result } = renderHook(() => useChatScroll('room-1', timelineOf([101, 102, 103])))
    expect(result.current.initialTopMostItemIndex).toBe(1)
  })

  it('restores to the message row when letters come before it', () => {
    vi.mocked(persisted.getConv).mockReturnValue({ value: '102' })
    const { result } = renderHook(() => useChatScroll('room-1', timelineOf([101, 102, 103], [letter(7, 50)])))
    // letter-7, msg-101, msg-102, msg-103
    expect(result.current.initialTopMostItemIndex).toBe(2)
  })

  it('falls back to the bottom for an unknown id, and to 0 for an empty room', () => {
    vi.mocked(persisted.getConv).mockReturnValue({ value: '999' })
    expect(renderHook(() => useChatScroll('room-1', timelineOf([1, 2, 3]))).result.current.initialTopMostItemIndex).toBe(2)
    expect(renderHook(() => useChatScroll('room-1', timelineOf([]))).result.current.initialTopMostItemIndex).toBe(0)
  })

  it('reads the room key', () => {
    renderHook(() => useChatScroll('room-A', timelineOf([1])))
    expect(persisted.getConv).toHaveBeenCalledWith('sakadesk_scroll_room-A', {})
  })

  it('resolves the range one frame later and saves 500 ms after it settles', () => {
    const { result } = renderHook(() => useChatScroll('room-1', timelineOf([101, 102, 103])))
    act(() => result.current.handleRangeChanged({ startIndex: 1, endIndex: 2 }))
    act(() => { vi.advanceTimersToNextFrame() })
    act(() => { vi.advanceTimersByTime(499) })
    expect(persisted.setConv).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(persisted.setConv).toHaveBeenCalledWith('sakadesk_scroll_room-1', { value: '102' })
  })

  it('asks topVisibleIndex which row the user sees (rows behind the sticky header do not count)', () => {
    const topVisible = vi.fn((range: ListRange) => range.startIndex + 1)
    const { result } = renderHook(() => useChatScroll('room-1', timelineOf([101, 102, 103]), topVisible))
    act(() => result.current.handleRangeChanged({ startIndex: 0, endIndex: 2 }))
    act(() => { vi.advanceTimersToNextFrame() })
    act(() => { vi.advanceTimersByTime(500) })
    expect(topVisible).toHaveBeenCalledWith({ startIndex: 0, endIndex: 2 })
    expect(persisted.setConv).toHaveBeenCalledWith('sakadesk_scroll_room-1', { value: '102' })
  })

  it('a letter on top saves the nearest message above it, or below at the very top', () => {
    // letter-7, msg-101, letter-8, msg-102
    const timeline = timelineOf([101, 102], [letter(7, 50), letter(8, 101.5)])
    const { result } = renderHook(() => useChatScroll('room-1', timeline))
    act(() => result.current.handleRangeChanged({ startIndex: 2, endIndex: 3 }))
    act(() => { result.current.savePositionImmediate() })
    expect(persisted.setConv).toHaveBeenLastCalledWith('sakadesk_scroll_room-1', { value: '101' })
    act(() => result.current.handleRangeChanged({ startIndex: 0, endIndex: 3 }))
    act(() => { result.current.savePositionImmediate() })
    expect(persisted.setConv).toHaveBeenCalledTimes(1) // still 101: never written twice

    // At the very top the letter has no message above it: the one below is saved.
    const top = renderHook(() => useChatScroll('room-2', timeline))
    act(() => top.result.current.handleRangeChanged({ startIndex: 0, endIndex: 3 }))
    act(() => { top.result.current.savePositionImmediate() })
    expect(persisted.setConv).toHaveBeenLastCalledWith('sakadesk_scroll_room-2', { value: '101' })
  })

  it('savePositionImmediate resolves a pending range at once', () => {
    const { result } = renderHook(() => useChatScroll('room-1', timelineOf([101, 102, 103])))
    act(() => result.current.handleRangeChanged({ startIndex: 1, endIndex: 2 }))
    act(() => { result.current.savePositionImmediate() })
    expect(persisted.setConv).toHaveBeenCalledWith('sakadesk_scroll_room-1', { value: '102' })
  })

  // SD-FE-STATE-03: a scroll-then-close within the debounce must still persist.
  it('flushes the pending position on pagehide through the beacon', () => {
    const { result } = renderHook(() => useChatScroll('room-1', timelineOf([101, 102, 103])))
    act(() => result.current.handleRangeChanged({ startIndex: 1, endIndex: 2 }))
    expect(persisted.setConv).not.toHaveBeenCalled()
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(persisted.setConvBeacon).toHaveBeenCalledWith('sakadesk_scroll_room-1', { value: '102' })
  })

  it('saves the previous room when the room changes', () => {
    const { result, rerender } = renderHook(({ id, t }) => useChatScroll(id, t), {
      initialProps: { id: 'room-1', t: timelineOf([101, 102, 103]) },
    })
    act(() => result.current.handleRangeChanged({ startIndex: 1, endIndex: 2 }))
    act(() => { vi.advanceTimersToNextFrame() })
    rerender({ id: 'room-2', t: timelineOf([201]) })
    expect(persisted.setConv).toHaveBeenCalledWith('sakadesk_scroll_room-1', { value: '102' })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(persisted.setConv).toHaveBeenCalledTimes(1)
  })

  it('an old-room frame that fires before the room-switch effect never saves a new-room id', () => {
    // The rAF queued by the old room can run after the new room's render commits but before
    // the passive room-switch effect: it must not resolve the old range on the new timeline.
    const { result, rerender } = renderHook(({ id, t }) => {
      const r = useChatScroll(id, t)
      useLayoutEffect(() => { if (id === 'room-2') vi.advanceTimersToNextFrame() }, [id])
      return r
    }, { initialProps: { id: 'room-1', t: timelineOf([101, 102, 103]) } })
    act(() => result.current.handleRangeChanged({ startIndex: 1, endIndex: 2 }))
    act(() => { vi.advanceTimersToNextFrame() })
    act(() => result.current.handleRangeChanged({ startIndex: 2, endIndex: 2 }))
    rerender({ id: 'room-2', t: timelineOf([201, 202, 203]) })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(persisted.setConv).toHaveBeenCalledTimes(1)
    expect(persisted.setConv).toHaveBeenCalledWith('sakadesk_scroll_room-1', { value: '102' })
  })

  it.each([
    ['a pagehide flush', () => { window.dispatchEvent(new Event('pagehide')) }],
    ['a lagging frame', () => { vi.advanceTimersToNextFrame() }],
  ])('a new-room range resolved by %s before the room-switch effect is not saved under the old key', (_name, resolve) => {
    // After the new room commits, its list can report a range (stamped with the new key) and
    // have it resolved before the passive room-switch effect has moved keyRef to the new key.
    const { result, rerender } = renderHook(({ id, t }) => {
      const r = useChatScroll(id, t)
      useLayoutEffect(() => {
        if (id !== 'room-2') return
        r.handleRangeChanged({ startIndex: 2, endIndex: 2 })
        resolve()
      }, [id, r])
      return r
    }, { initialProps: { id: 'room-1', t: timelineOf([101, 102, 103]) } })
    act(() => result.current.handleRangeChanged({ startIndex: 1, endIndex: 2 }))
    act(() => { vi.advanceTimersToNextFrame() })
    rerender({ id: 'room-2', t: timelineOf([201, 202, 203]) })
    act(() => { vi.advanceTimersByTime(1000) })
    const writes = [...vi.mocked(persisted.setConv).mock.calls, ...vi.mocked(persisted.setConvBeacon).mock.calls]
    const room1 = writes.filter(([key]) => key === 'sakadesk_scroll_room-1').map(([, value]) => value)
    expect(room1).not.toHaveLength(0)
    expect(room1).toEqual(room1.map(() => ({ value: '102' })))
  })

  it('saves on unmount instead of dropping a pending save', () => {
    const { result, unmount } = renderHook(() => useChatScroll('room-1', timelineOf([101, 102, 103])))
    act(() => result.current.handleRangeChanged({ startIndex: 1, endIndex: 2 }))
    act(() => { vi.advanceTimersToNextFrame() })
    unmount()
    expect(persisted.setConv).toHaveBeenCalledWith('sakadesk_scroll_room-1', { value: '102' })
  })

  it('removes the pagehide listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useChatScroll('room-1', timelineOf([1])))
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('pagehide', expect.any(Function))
  })
})
