import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }))
import { clientLog } from '../utils/clientLog'
import { useAppStore } from '../store/appStore'
import { openMemoriesFromToast, parseMemoriesLink } from './openMemories'

const PATH = '日向坂46/messages/34 金村 美玖/58 金村 美玖'
const notOnboarding = () => false

describe('parseMemoriesLink', () => {
  it.each([
    [{ page: 'onThisDay', monthDay: '11-11' }],
    [{ page: 'onThisDay', monthDay: '02-29', year: 2024 }],
    [{ page: 'memoir', memberPath: PATH, tab: 'binder' }],
    [{ page: 'memoir', memberPath: PATH, tab: 'binder', cardKey: 'anniv.y1' }],
    [{ page: 'memoir', memberPath: PATH, tab: 'binder', cardKey: 'special.birthday@2026' }],
    [{ page: 'memoir', memberPath: PATH, tab: 'binder', cardKey: 'change.avatar.2025-03-01' }],
    [{ page: 'recap', year: 2026 }],
  ])('accepts %j', (route) => {
    expect(parseMemoriesLink({ service: 'hinatazaka46', route })).toEqual({ service: 'hinatazaka46', route })
  })

  it('accepts a memberPath of 512 and a service of 64 characters', () => {
    const route = { page: 'memoir', memberPath: 'あ'.repeat(512), tab: 'binder' }
    expect(parseMemoriesLink({ service: 'a'.repeat(64), route })).toEqual({ service: 'a'.repeat(64), route })
  })

  it('keeps only whitelisted fields', () => {
    expect(parseMemoriesLink({
      service: 'hinatazaka46', route: { page: 'recap', year: 2026, memberPath: PATH, extra: 1 },
    })).toEqual({ service: 'hinatazaka46', route: { page: 'recap', year: 2026 } })
  })

  it.each([
    ['monthDay 13-01', { page: 'onThisDay', monthDay: '13-01' }],
    ['monthDay 00-10', { page: 'onThisDay', monthDay: '00-10' }],
    ['missing monthDay', { page: 'onThisDay' }],
    ['string year', { page: 'onThisDay', monthDay: '11-11', year: '2026' }],
    ['year below 2000', { page: 'onThisDay', monthDay: '11-11', year: 1999 }],
    ['year above 2100', { page: 'onThisDay', monthDay: '11-11', year: 2101 }],
    ['fractional year', { page: 'onThisDay', monthDay: '11-11', year: 2024.5 }],
    ['cardKey a/b', { page: 'memoir', memberPath: PATH, tab: 'binder', cardKey: 'a/b' }],
    ['cardKey upper case', { page: 'memoir', memberPath: PATH, tab: 'binder', cardKey: 'Anniv.y1' }],
    ['cardKey too long', { page: 'memoir', memberPath: PATH, tab: 'binder', cardKey: 'a'.repeat(81) }],
    ['empty cardKey', { page: 'memoir', memberPath: PATH, tab: 'binder', cardKey: '' }],
    ['missing memberPath', { page: 'memoir', tab: 'binder' }],
    ['memberPath over 512', { page: 'memoir', memberPath: 'あ'.repeat(513), tab: 'binder' }],
    ['empty memberPath', { page: 'memoir', memberPath: '', tab: 'binder' }],
    ['timeline tab', { page: 'memoir', memberPath: PATH, tab: 'timeline' }],
    ['missing tab', { page: 'memoir', memberPath: PATH }],
    ['string recap year', { page: 'recap', year: '2026' }],
    ['recap year out of bounds', { page: 'recap', year: 3000 }],
    ['missing recap year', { page: 'recap' }],
    ['unknown page', { page: 'nowhere' }],
    ['album page', { page: 'album' }],
    ['home page', { page: 'home' }],
  ])('rejects %s', (_label, route) => {
    expect(parseMemoriesLink({ service: 'hinatazaka46', route })).toBeNull()
  })

  it.each([
    ['null', null],
    ['a string', 'hinatazaka46'],
    ['a number', 7],
    ['an array', []],
    ['no route', { service: 'hinatazaka46' }],
    ['a null route', { service: 'hinatazaka46', route: null }],
    ['no service', { route: { page: 'recap', year: 2026 } }],
    ['an empty service', { service: '', route: { page: 'recap', year: 2026 } }],
    ['a service over 64', { service: 'a'.repeat(65), route: { page: 'recap', year: 2026 } }],
  ])('rejects %s', (_label, payload) => {
    expect(parseMemoriesLink(payload)).toBeNull()
  })
})

describe('openMemoriesFromToast', () => {
  beforeEach(() => {
    vi.mocked(clientLog).mockClear()
    useAppStore.setState({
      selectedServices: ['hinatazaka46', 'sakurazaka46'],
      activeService: 'hinatazaka46',
      activeFeatures: { hinatazaka46: 'messages' },
      memoriesDeepLink: null,
    })
  })

  it('refuses a malformed payload', () => {
    expect(openMemoriesFromToast({ service: 'hinatazaka46', route: { page: 'album' } }, notOnboarding)).toBe(false)
    expect(clientLog).toHaveBeenCalledWith('notify_open_memories', { delivered: false, reason: 'malformed' })
    expect(useAppStore.getState().memoriesDeepLink).toBeNull()
  })

  it('refuses a service the user has not added, without logging it', () => {
    expect(openMemoriesFromToast({ service: 'nogizaka46', route: { page: 'recap', year: 2026 } }, notOnboarding)).toBe(false)
    expect(clientLog).toHaveBeenCalledWith('notify_open_memories', { delivered: false, reason: 'unknown_service' })
    expect(useAppStore.getState().activeService).toBe('hinatazaka46')
  })

  it('refuses during onboarding', () => {
    expect(openMemoriesFromToast({ service: 'sakurazaka46', route: { page: 'recap', year: 2026 } }, () => true)).toBe(false)
    expect(clientLog).toHaveBeenCalledWith('notify_open_memories', {
      delivered: false, reason: 'onboarding', service: 'sakurazaka46',
    })
    expect(useAppStore.getState().memoriesDeepLink).toBeNull()
  })

  it('opens Memories at the route and logs the service and page code only', () => {
    const route = { page: 'memoir', memberPath: PATH, tab: 'binder', cardKey: 'anniv.y1' }
    expect(openMemoriesFromToast({ service: 'sakurazaka46', route }, notOnboarding)).toBe(true)
    const s = useAppStore.getState()
    expect(s.activeService).toBe('sakurazaka46')
    expect(s.activeFeatures.sakurazaka46).toBe('memories')
    expect(s.memoriesDeepLink).toMatchObject({ service: 'sakurazaka46', route })
    expect(clientLog).toHaveBeenCalledWith('notify_open_memories', {
      delivered: true, service: 'sakurazaka46', target: 'memoir',
    })
    expect(JSON.stringify(vi.mocked(clientLog).mock.calls)).not.toContain('金村')
    expect(JSON.stringify(vi.mocked(clientLog).mock.calls)).not.toContain('anniv')
  })

  it('logs On This Day as its snake_case page code', () => {
    openMemoriesFromToast({ service: 'hinatazaka46', route: { page: 'onThisDay', monthDay: '11-11', year: 2023 } }, notOnboarding)
    expect(clientLog).toHaveBeenCalledWith('notify_open_memories', {
      delivered: true, service: 'hinatazaka46', target: 'on_this_day',
    })
  })

  it('bumps the nonce for every click, even to the same route', () => {
    const payload = { service: 'hinatazaka46', route: { page: 'recap', year: 2026 } }
    openMemoriesFromToast(payload, notOnboarding)
    const first = useAppStore.getState().memoriesDeepLink!.nonce
    openMemoriesFromToast(payload, notOnboarding)
    expect(useAppStore.getState().memoriesDeepLink!.nonce).toBeGreaterThan(first)
  })
})

describe('appStore memories deep link', () => {
  beforeEach(() => {
    useAppStore.setState({ activeService: 'hinatazaka46', activeFeatures: {}, memoriesDeepLink: null })
  })

  it('switches feature on the same service without touching the active service', () => {
    const setActiveService = vi.spyOn(useAppStore.getState(), 'setActiveService')
    useAppStore.getState().openMemoriesAt('hinatazaka46', { page: 'recap', year: 2026 })
    expect(useAppStore.getState().activeFeatures.hinatazaka46).toBe('memories')
    expect(setActiveService).not.toHaveBeenCalled()
    setActiveService.mockRestore()
  })

  it('clears only when the nonce matches', () => {
    useAppStore.getState().openMemoriesAt('hinatazaka46', { page: 'recap', year: 2026 })
    const { nonce } = useAppStore.getState().memoriesDeepLink!
    useAppStore.getState().clearMemoriesDeepLink(nonce - 1)
    expect(useAppStore.getState().memoriesDeepLink).not.toBeNull()
    useAppStore.getState().clearMemoriesDeepLink(nonce)
    expect(useAppStore.getState().memoriesDeepLink).toBeNull()
  })

  it('drops a lingering link when its service is removed', () => {
    useAppStore.setState({ selectedServices: ['hinatazaka46', 'sakurazaka46'] })
    useAppStore.getState().openMemoriesAt('sakurazaka46', { page: 'recap', year: 2026 })
    useAppStore.getState().removeSelectedService('hinatazaka46')
    expect(useAppStore.getState().memoriesDeepLink).not.toBeNull()
    useAppStore.getState().removeSelectedService('sakurazaka46')
    expect(useAppStore.getState().memoriesDeepLink).toBeNull()
  })

  it('drops a lingering link when the service list no longer has its service', () => {
    useAppStore.setState({ selectedServices: ['hinatazaka46', 'sakurazaka46'] })
    useAppStore.getState().openMemoriesAt('sakurazaka46', { page: 'recap', year: 2026 })
    useAppStore.getState().setSelectedServices(['sakurazaka46'])
    expect(useAppStore.getState().memoriesDeepLink).not.toBeNull()
    useAppStore.getState().setSelectedServices(['hinatazaka46'])
    expect(useAppStore.getState().memoriesDeepLink).toBeNull()
  })

  it('is never persisted', () => {
    useAppStore.getState().openMemoriesAt('hinatazaka46', { page: 'recap', year: 2026 })
    const partial = useAppStore.persist.getOptions().partialize!(useAppStore.getState()) as Record<string, unknown>
    expect(partial).not.toHaveProperty('memoriesDeepLink')
  })
})
