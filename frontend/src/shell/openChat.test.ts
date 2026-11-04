import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAppStore } from '../store/appStore'
import { formatName } from '../utils'
import { openChat, openChatFromToast } from './openChat'

const PATH = 'Hinatazaka46/messages/12 Group/34 Member'

describe('openChat', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeService: 'hinatazaka46',
      selectedConversations: {},
      conversationNavCounter: 0,
      targetMessageId: null,
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 204 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('selects the conversation and triggers navigation for the same service', () => {
    openChat({ service: 'hinatazaka46', path: PATH, name: 'Member', is_group_chat: false })
    const s = useAppStore.getState()
    expect(s.selectedConversations['hinatazaka46']).toEqual({
      path: PATH,
      name: formatName('Member'),
      isGroupChat: false,
    })
    expect(s.activeService).toBe('hinatazaka46')
    expect(s.conversationNavCounter).toBe(1)
  })

  it('switches service without triggering navigation when different', () => {
    openChat({ service: 'sakurazaka46', path: PATH, name: 'Room', is_group_chat: true })
    const s = useAppStore.getState()
    expect(s.activeService).toBe('sakurazaka46')
    expect(s.conversationNavCounter).toBe(0)
    expect(s.selectedConversations['sakurazaka46']).toMatchObject({ path: PATH, isGroupChat: true })
  })

  it('openChat itself does not log (search navigation is not a toast click)', () => {
    openChat({ service: 'hinatazaka46', path: PATH, name: 'Member', is_group_chat: false })
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('openChatFromToast navigates and logs notify_open_chat with the service only', () => {
    openChatFromToast({ service: 'hinatazaka46', path: PATH, name: 'Member', is_group_chat: false })
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
    expect(body).toEqual({
      event: 'notify_open_chat',
      fields: { service: 'hinatazaka46', has_target: false },
    })
    expect(useAppStore.getState().conversationNavCounter).toBe(1)
    expect(useAppStore.getState().targetMessageId).toBeNull()
  })

  it('sets the target message before navigating', () => {
    const order: string[] = []
    const unsubscribe = useAppStore.subscribe((s, prev) => {
      if (s.targetMessageId !== prev.targetMessageId) order.push(`target:${s.targetMessageId}`)
      if (s.selectedConversations !== prev.selectedConversations) order.push('select')
      if (s.activeService !== prev.activeService) order.push('service')
      if (s.conversationNavCounter !== prev.conversationNavCounter) order.push('nav')
    })
    try {
      openChat({ service: 'hinatazaka46', path: PATH, name: 'Member', is_group_chat: false, message_id: 4321 })
      openChat({ service: 'sakurazaka46', path: PATH, name: 'Room', is_group_chat: true, message_id: 77 })
    } finally {
      unsubscribe()
    }
    expect(order[0]).toBe('target:4321')
    expect(order.indexOf('target:4321')).toBeLessThan(order.indexOf('nav'))
    expect(order.indexOf('target:77')).toBeLessThan(order.indexOf('service'))
    expect(useAppStore.getState().targetMessageId).toBe(77)
  })

  it('openChatFromToast jumps to the toast message and logs has_target', () => {
    openChatFromToast({
      service: 'hinatazaka46', path: PATH, name: 'Member', is_group_chat: false, message_id: 4321,
    })
    const s = useAppStore.getState()
    expect(s.targetMessageId).toBe(4321)
    expect(s.conversationNavCounter).toBe(1)
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body).toEqual({
      event: 'notify_open_chat',
      fields: { service: 'hinatazaka46', has_target: true },
    })
  })

  it.each([0, -1, 1.5, '12', null, Number.NaN, Number.MAX_SAFE_INTEGER + 2])(
    'ignores malformed message_id %s but still opens the chat',
    (bad) => {
      vi.spyOn(console, 'debug').mockImplementation(() => {})
      useAppStore.setState({ targetMessageId: 5 })
      openChatFromToast({
        service: 'hinatazaka46', path: PATH, name: 'Member', is_group_chat: false,
        message_id: bad as never,
      })
      const s = useAppStore.getState()
      expect(s.selectedConversations['hinatazaka46']).toMatchObject({ path: PATH })
      expect(s.conversationNavCounter).toBe(1)
      expect(s.targetMessageId).toBe(5)
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
      expect(body).toEqual({
        event: 'notify_open_chat',
        fields: { service: 'hinatazaka46', has_target: false, reason: 'bad_message_id' },
      })
    },
  )

  it('leaves a target set by the caller alone when no message_id is given (search)', () => {
    useAppStore.getState().setTargetMessageId(99)
    openChat({ service: 'hinatazaka46', path: PATH, name: 'Member', is_group_chat: false })
    expect(useAppStore.getState().targetMessageId).toBe(99)
    expect(useAppStore.getState().conversationNavCounter).toBe(1)
  })

  it('openChatFromToast ignores malformed input without logging', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    openChatFromToast({ service: 'x' } as never)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    expect(useAppStore.getState().selectedConversations).toEqual({})
  })

  it.each([
    null,
    undefined,
    'x',
    {},
    { service: '', path: PATH, name: 'n', is_group_chat: false },
    { service: 'hinatazaka46', path: 1, name: 'n', is_group_chat: false },
    { service: 'hinatazaka46', path: PATH, name: 'n' },
  ])('ignores malformed input %#', (bad) => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    openChat(bad as never)
    const s = useAppStore.getState()
    expect(s.selectedConversations).toEqual({})
    expect(s.conversationNavCounter).toBe(0)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    expect(debug).toHaveBeenCalled()
  })
})
