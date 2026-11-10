import { useAppStore } from '../store/appStore'
import { clientLog } from '../utils/clientLog'
import type { MemoriesRoute } from '../features/memories/MemoriesFeature'
import { MEMORIES_PAGE_CODES, type NotifyOpenMemoriesReason } from '../features/memories/memoriesLog'

declare global {
  interface Window {
    /**
     * Installed by App; called by the desktop host when a Memories toast is clicked with
     * `{service, route}`. Returns whether Memories was opened at the route.
     */
    __sakadeskOpenMemories?: (payload: unknown) => boolean
  }
}

/** A Memories page a notification can open, already whitelisted. */
export interface MemoriesLink {
  service: string
  route: MemoriesRoute
}

const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
/** The backend's card-key pattern (`capsule.CARD_KEY_RE`): base, per-year (`@2026`) and dated keys. */
const CARD_KEY = /^[a-z0-9_.@-]{1,80}$/
const MAX_SERVICE = 64
const MAX_MEMBER_PATH = 512

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isYear = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 2000 && v <= 2100

function parseRoute(raw: unknown): MemoriesRoute | null {
  if (!isRecord(raw)) return null
  switch (raw.page) {
    case 'onThisDay': {
      if (typeof raw.monthDay !== 'string' || !MONTH_DAY.test(raw.monthDay)) return null
      if (raw.year === undefined) return { page: 'onThisDay', monthDay: raw.monthDay }
      return isYear(raw.year) ? { page: 'onThisDay', monthDay: raw.monthDay, year: raw.year } : null
    }
    case 'memoir': {
      if (typeof raw.memberPath !== 'string' || raw.memberPath === '' || raw.memberPath.length > MAX_MEMBER_PATH) return null
      if (raw.tab !== 'binder') return null
      const base = { page: 'memoir', memberPath: raw.memberPath, tab: 'binder' } as const
      if (raw.cardKey === undefined) return base
      return typeof raw.cardKey === 'string' && CARD_KEY.test(raw.cardKey) ? { ...base, cardKey: raw.cardKey } : null
    }
    case 'recap':
      return isYear(raw.year) ? { page: 'recap', year: raw.year } : null
    default:
      return null
  }
}

/**
 * Strict whitelist of a notification's deep-link payload `{service, route}`: only the On This
 * Day detail, her binder (optionally at one card) and a year's recap, with only their known
 * fields copied. `service` is at most 64 characters and `memberPath` at most 512. Anything else
 * is `null`.
 */
export function parseMemoriesLink(payload: unknown): MemoriesLink | null {
  if (!isRecord(payload) || typeof payload.service !== 'string') return null
  if (payload.service === '' || payload.service.length > MAX_SERVICE) return null
  const route = parseRoute(payload.route)
  return route ? { service: payload.service, route } : null
}

function refuse(reason: NotifyOpenMemoriesReason, service?: string): false {
  clientLog('notify_open_memories', { delivered: false, reason, ...(service ? { service } : {}) })
  return false
}

/**
 * Entry point for a Memories toast click (`window.__sakadeskOpenMemories`): opens Memories at
 * the toast's page and leaves a `notify_open_memories` breadcrumb (the service and page code
 * only, never the member path or card key). Refused (false) for a malformed payload, a service
 * the fan has not added (not logged: it is not a known code) and while onboarding hides the app.
 */
export function openMemoriesFromToast(payload: unknown, isOnboarding: () => boolean): boolean {
  const link = parseMemoriesLink(payload)
  if (!link) return refuse('malformed')
  const { selectedServices, openMemoriesAt } = useAppStore.getState()
  if (!selectedServices.includes(link.service)) return refuse('unknown_service')
  if (isOnboarding()) return refuse('onboarding', link.service)
  openMemoriesAt(link.service, link.route)
  clientLog('notify_open_memories', {
    delivered: true, service: link.service, target: MEMORIES_PAGE_CODES[link.route.page],
  })
  return true
}
