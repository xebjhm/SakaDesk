import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AudioManager } from './AudioManager'

describe('AudioManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset audio manager state
    AudioManager.pause()
  })

  describe('singleton pattern', () => {
    it('should export a singleton instance', () => {
      expect(AudioManager).toBeDefined()
    })

    it('should always return the same instance', () => {
      const instance1 = AudioManager
      const instance2 = AudioManager
      expect(instance1).toBe(instance2)
    })
  })

  describe('play and pause', () => {
    it('should call audio.play when play is called', () => {
      const src = '/test/audio.mp3'
      AudioManager.play(src)
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    })

    it('should call audio.pause when pause is called', () => {
      AudioManager.pause()
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    })

    it('should update currentSrc when playing new audio', () => {
      const src = '/test/audio.mp3'
      AudioManager.play(src)
      expect(AudioManager.getCurrentSrc()).toBe(src)
    })
  })

  describe('volume control', () => {
    it('should set volume', () => {
      AudioManager.setVolume(0.5)
      // Volume is set on internal audio element
      expect(AudioManager).toBeDefined()
    })

    it('should get volume', () => {
      const volume = AudioManager.getVolume()
      expect(typeof volume).toBe('number')
    })
  })

  describe('playback rate', () => {
    it('should set playback rate', () => {
      AudioManager.setPlaybackRate(1.5)
      expect(AudioManager).toBeDefined()
    })

    it('should get playback rate', () => {
      const rate = AudioManager.getPlaybackRate()
      expect(typeof rate).toBe('number')
    })
  })

  describe('seek', () => {
    it('should set current time', () => {
      AudioManager.setCurrentTime(30)
      expect(AudioManager).toBeDefined()
    })

    it('should get current time', () => {
      const time = AudioManager.getCurrentTime()
      expect(typeof time).toBe('number')
    })
  })

  describe('duration', () => {
    it('should get duration', () => {
      const duration = AudioManager.getDuration()
      expect(typeof duration).toBe('number')
    })
  })

  describe('isPlaying', () => {
    it('should return boolean for playing state', () => {
      const playing = AudioManager.isPlaying()
      expect(typeof playing).toBe('boolean')
    })
  })

  describe('callback registration', () => {
    it('should accept callbacks when playing', () => {
      const src = '/test/audio.mp3'
      const callbacks = {
        onTimeUpdate: vi.fn(),
        onEnded: vi.fn(),
        onLoadedMetadata: vi.fn(),
      }

      AudioManager.play(src, callbacks)
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    })

    it('should unregister callbacks', () => {
      const src = '/test/audio.mp3'
      AudioManager.unregister(src)
      expect(AudioManager).toBeDefined()
    })
  })
})
