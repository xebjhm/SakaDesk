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
    expect(body).toEqual({ event: 'notify_open_chat', fields: { service: 'hinatazaka46' } })
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
