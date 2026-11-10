import { useAppStore } from '../store/appStore'
import { formatName } from '../utils'
import { clientLog } from '../utils/clientLog'

declare global {
  interface Window {
    /** Installed by App; called by the desktop host when a toast is clicked. */
    __sakadeskOpenChat?: (target: OpenChatTarget) => void
    /**
     * Installed by App; called by the desktop host when a "log in again" toast is
     * clicked. Returns whether the service's login dialog was opened.
     */
    __sakadeskOpenLogin?: (service: string) => boolean
  }
}

export interface OpenChatTarget {
  service: string
  path: string
  name: string
  is_group_chat: boolean
  /**
   * Message to scroll to once the chat opens (a toast's previewed message).
   * Used only when it is a positive integer; anything else is ignored and
   * the chat still opens.
   */
  message_id?: number
}

function isMessageId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
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
 * Navigate to a chat: set the message to scroll to (when `message_id` is a
 * valid id), select the conversation, show the messages feature and switch
 * service (or re-trigger navigation when already on it). The target message
 * is set first so the destination view sees it on mount. Without a
 * `message_id` the current target is left alone: search sets its own before
 * calling. Shared by the search modal and the desktop toast click
 * (window.__sakadeskOpenChat).
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
    setTargetMessageId,
    triggerConversationNavigation,
    activeService,
  } = useAppStore.getState()

  if (isMessageId(target.message_id)) {
    setTargetMessageId(target.message_id)
  } else if (target.message_id !== undefined) {
    console.debug('[openChat] ignored malformed message_id')
  }

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
 * the chat at the toast's message, then leaves a `notify_open_chat` breadcrumb
 * (service code and `has_target`; `reason=bad_message_id` when a malformed id
 * was ignored). Kept apart from `openChat` so search navigation does not log
 * as a toast click.
 */
export function openChatFromToast(target: OpenChatTarget): void {
  if (!isOpenChatTarget(target)) {
    console.debug('[openChat] ignored malformed target')
    return
  }
  openChat(target)
  const hasTarget = isMessageId(target.message_id)
  clientLog('notify_open_chat', {
    service: target.service,
    has_target: hasTarget,
    ...(!hasTarget && target.message_id !== undefined ? { reason: 'bad_message_id' } : {}),
  })
}
