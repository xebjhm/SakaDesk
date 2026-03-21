import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadMedia } from './download'

describe('downloadMedia', () => {
    let appendChildSpy: ReturnType<typeof vi.spyOn>
    let capturedIframe: HTMLIFrameElement | null

    beforeEach(() => {
        capturedIframe = null
        appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
            capturedIframe = node as HTMLIFrameElement
            return node
        })
        vi.useFakeTimers()
    })

    afterEach(() => {
        appendChildSpy.mockRestore()
        vi.useRealTimers()
    })

    describe('content media routing', () => {
        it('should rewrite /api/content/media/ to /api/content/download/', () => {
            downloadMedia('/api/content/media/abc123', 'photo.jpg')

            expect(capturedIframe).not.toBeNull()
            expect(capturedIframe!.src).toContain('/api/content/download/abc123')
            expect(capturedIframe!.src).toContain('?filename=photo.jpg')
        })

        it('should encode the filename query parameter', () => {
            downloadMedia('/api/content/media/file1', 'my file (1).jpg')

            expect(capturedIframe!.src).toContain(
                `?filename=${encodeURIComponent('my file (1).jpg')}`,
            )
        })
    })

    describe('blog image routing', () => {
        it('should append &download= when URL already has query params', () => {
            downloadMedia('/api/blogs/image?url=https%3A%2F%2Fexample.com%2Fpic.png', 'pic.png')

            expect(capturedIframe!.src).toContain('/api/blogs/image?url=')
            expect(capturedIframe!.src).toContain('&download=pic.png')
        })

        it('should append ?download= when URL has no query params', () => {
            downloadMedia('/api/blogs/image', 'pic.png')

            expect(capturedIframe!.src).toContain('/api/blogs/image?download=pic.png')
        })
    })

    describe('external URL routing', () => {
        it('should proxy https URLs through /api/blogs/proxy-image', () => {
            const externalUrl = 'https://cdn.example.com/image.png'
            downloadMedia(externalUrl, 'image.png')

            expect(capturedIframe!.src).toContain('/api/blogs/proxy-image?url=')
            expect(capturedIframe!.src).toContain(encodeURIComponent(externalUrl))
            expect(capturedIframe!.src).toContain('&download=image.png')
        })

        it('should proxy http URLs through /api/blogs/proxy-image', () => {
            const externalUrl = 'http://cdn.example.com/image.png'
            downloadMedia(externalUrl, 'image.png')

            expect(capturedIframe!.src).toContain('/api/blogs/proxy-image?url=')
            expect(capturedIframe!.src).toContain(encodeURIComponent(externalUrl))
            expect(capturedIframe!.src).toContain('&download=image.png')
        })
    })

    describe('origin-stripping (absolute local URLs)', () => {
        it('should strip window.location.origin and route through content media', () => {
            const origin = window.location.origin // http://localhost:3000 in jsdom
            downloadMedia(`${origin}/api/content/media/abc123`, 'photo.jpg')

            expect(capturedIframe!.src).toContain('/api/content/download/abc123')
            expect(capturedIframe!.src).toContain('?filename=photo.jpg')
            // Must NOT go through the external proxy
            expect(capturedIframe!.src).not.toContain('proxy-image')
        })

        it('should strip origin and route through blog image path', () => {
            const origin = window.location.origin
            downloadMedia(`${origin}/api/blogs/image?url=https%3A%2F%2Fexample.com`, 'pic.png')

            expect(capturedIframe!.src).toContain('/api/blogs/image?url=')
            expect(capturedIframe!.src).toContain('&download=pic.png')
            expect(capturedIframe!.src).not.toContain('proxy-image')
        })
    })

    describe('other local URL routing', () => {
        it('should append ?download= to a local path without query params', () => {
            downloadMedia('/api/some/other/endpoint', 'file.zip')

            expect(capturedIframe!.src).toContain('/api/some/other/endpoint?download=file.zip')
        })

        it('should append &download= to a local path with existing query params', () => {
            downloadMedia('/api/some/endpoint?key=value', 'file.zip')

            expect(capturedIframe!.src).toContain('/api/some/endpoint?key=value&download=file.zip')
        })
    })

    describe('iframe behavior', () => {
        it('should create a hidden iframe', () => {
            downloadMedia('/api/content/media/abc', 'test.jpg')

            expect(capturedIframe).not.toBeNull()
            expect(capturedIframe!.style.display).toBe('none')
            expect(appendChildSpy).toHaveBeenCalledTimes(1)
        })

        it('should remove the iframe after 60 seconds', () => {
            downloadMedia('/api/content/media/abc', 'test.jpg')

            const removeSpy = vi.spyOn(capturedIframe!, 'remove')
            expect(removeSpy).not.toHaveBeenCalled()

            vi.advanceTimersByTime(60000)
            expect(removeSpy).toHaveBeenCalledOnce()
        })
    })
})
