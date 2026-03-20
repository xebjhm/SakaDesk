import { describe, it, expect } from 'vitest'
import { cn, formatDateTime, formatDuration, formatDownloadFilename } from './classnames'

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

describe('formatDateTime', () => {
  it('should format Date object to YYYY/MM/DD HH:mm', () => {
    const date = new Date(2024, 5, 15, 14, 30) // June 15, 2024, 14:30
    expect(formatDateTime(date)).toBe('2024/06/15 14:30')
  })

  it('should format ISO string to YYYY/MM/DD HH:mm', () => {
    // Create a date in local timezone to avoid timezone issues in tests
    const date = new Date(2024, 0, 1, 9, 5) // Jan 1, 2024, 09:05
    expect(formatDateTime(date.toISOString())).toBe('2024/01/01 09:05')
  })

  it('should pad single-digit months and days', () => {
    const date = new Date(2024, 0, 5, 8, 3) // Jan 5, 2024, 08:03
    expect(formatDateTime(date)).toBe('2024/01/05 08:03')
  })

  it('should pad single-digit hours and minutes', () => {
    const date = new Date(2024, 11, 31, 1, 2) // Dec 31, 2024, 01:02
    expect(formatDateTime(date)).toBe('2024/12/31 01:02')
  })

  it('should handle midnight correctly', () => {
    const date = new Date(2024, 6, 20, 0, 0) // July 20, 2024, 00:00
    expect(formatDateTime(date)).toBe('2024/07/20 00:00')
  })

  it('should handle end of day correctly', () => {
    const date = new Date(2024, 6, 20, 23, 59) // July 20, 2024, 23:59
    expect(formatDateTime(date)).toBe('2024/07/20 23:59')
  })
})

describe('formatDuration', () => {
  it('should format seconds to MM:SS', () => {
    expect(formatDuration(65)).toBe('01:05')
    expect(formatDuration(125)).toBe('02:05')
  })

  it('should handle zero seconds', () => {
    expect(formatDuration(0)).toBe('00:00')
  })

  it('should handle exactly one minute', () => {
    expect(formatDuration(60)).toBe('01:00')
  })

  it('should handle large durations', () => {
    expect(formatDuration(3661)).toBe('61:01') // 61 minutes, 1 second
    expect(formatDuration(7200)).toBe('120:00') // 2 hours
  })

  it('should floor fractional seconds', () => {
    expect(formatDuration(65.7)).toBe('01:05')
    expect(formatDuration(59.9)).toBe('00:59')
  })

  it('should return "--:--" for undefined', () => {
    expect(formatDuration(undefined)).toBe('--:--')
  })

  it('should return "--:--" for null', () => {
    // @ts-expect-error Testing null input
    expect(formatDuration(null)).toBe('--:--')
  })

  it('should pad single-digit minutes and seconds', () => {
    expect(formatDuration(5)).toBe('00:05')
    expect(formatDuration(9)).toBe('00:09')
    expect(formatDuration(61)).toBe('01:01')
  })
})

describe('formatDownloadFilename', () => {
  it('should extract filename from a simple path', () => {
    expect(formatDownloadFilename('https://example.com/media/photo.jpg')).toBe('photo.jpg')
  })

  it('should add YYYY-MM-DD_HHMM_ prefix when timestamp is provided', () => {
    // Build a local-time Date so the assertion is timezone-independent
    const ts = new Date(2026, 2, 3, 14, 33).toISOString() // March 3, 2026, 14:33 local
    expect(formatDownloadFilename('https://example.com/media/4954134.jpg', ts))
      .toBe('2026-03-03_1433_4954134.jpg')
  })

  it('should extract just the filename from Windows backslash paths (URL-encoded %5C)', () => {
    expect(formatDownloadFilename('https://example.com/media/C%3A%5CUsers%5Cphoto.jpg'))
      .toBe('photo.jpg')
  })

  it('should extract filename from ?filename= query param', () => {
    expect(formatDownloadFilename('/api/blogs/image?filename=img_0.jpg'))
      .toBe('img_0.jpg')
  })

  it('should return filename only when no timestamp is given', () => {
    expect(formatDownloadFilename('https://example.com/files/report.pdf'))
      .toBe('report.pdf')
  })

  it('should return filename only when timestamp is invalid', () => {
    expect(formatDownloadFilename('https://example.com/files/report.pdf', 'not-a-date'))
      .toBe('report.pdf')
  })

  it('should decode URL-encoded Japanese characters', () => {
    expect(formatDownloadFilename('https://example.com/media/%E5%86%99%E7%9C%9F.png'))
      .toBe('\u5199\u771f.png')
  })
})
