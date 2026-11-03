import { useAppStore } from '../store/appStore'
import { formatName } from '../utils'
import { clientLog } from '../utils/clientLog'

declare global {
  interface Window {
    /** Installed by App; called by the desktop host when a toast is clicked. */
    __sakadeskOpenChat?: (target: OpenChatTarget) => void
  }
}

export interface OpenChatTarget {
  service: string
  path: string
  name: string
  is_group_chat: boolean
}

function isOpenChatTarget(value: unknown): value is OpenChatTarget {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.service === 'string' && v.service !== '' &&
    typeof v.path === 'string' && v.path !== '' &&
    typeof v.name === 'string' &&
    typeof v.is_group_chat === 'boolean'
  )
}

/**
 * Navigate to a chat: select the conversation, show the messages feature and
 * switch service (or re-trigger navigation when already on it). Shared by the
 * search modal and the desktop toast click (window.__sakadeskOpenChat).
 */
export function openChat(target: OpenChatTarget): void {
  if (!isOpenChatTarget(target)) {
    console.debug('[openChat] ignored malformed target')
    return
  }
  const {
    setActiveService,
    setActiveFeature,
    setSelectedConversation,
    triggerConversationNavigation,
    activeService,
  } = useAppStore.getState()

  setSelectedConversation(target.service, {
    path: target.path,
    name: formatName(target.name),
    isGroupChat: target.is_group_chat,
  })
  setActiveFeature(target.service, 'messages')

  if (activeService !== target.service) {
    setActiveService(target.service)
  } else {
    triggerConversationNavigation()
  }
}

/**
 * Entry point for the desktop toast click (`window.__sakadeskOpenChat`): opens
 * the chat, then leaves a `notify_open_chat` breadcrumb (service code only).
 * Kept apart from `openChat` so search navigation does not log as a toast click.
 */
export function openChatFromToast(target: OpenChatTarget): void {
  if (!isOpenChatTarget(target)) {
    console.debug('[openChat] ignored malformed target')
    return
  }
  openChat(target)
  clientLog('notify_open_chat', { service: target.service })
}
