// frontend/e2e/fixtures/entry.ts
import type { Page } from '@playwright/test'
import { pinBlogs } from './blogs'

// The entry flow on mocked APIs: ToS, landing, login, setup and the first sync.
// Login tokens are single-session: EVERY /api/auth/** request is answered here, and any
// auth path this file does not know is aborted, so no test can reach the real login.

export const ALL_SERVICES = ['nogizaka46', 'sakurazaka46', 'hinatazaka46', 'yodel'] as const

export const RUNNING = {
  state: 'running', phase: 'scanning', phase_name: 'Scanning', phase_number: 1, completed: 5, total: 20,
  elapsed_seconds: 30, eta_seconds: 90, speed: 2.5, speed_unit: 'groups', detail: 'Fixture detail',
}
export const MEDIA = { ...RUNNING, phase: 'downloading', phase_name: 'Downloading', phase_number: 3, completed: 100, total: 500, speed_unit: 'files' }
export const COMPLETE = {
  state: 'complete', phase: 'complete', phase_number: 3, completed: 20, total: 20,
  elapsed_seconds: 60, speed: 2.5, speed_unit: 'groups',
}

export interface EntryState {
  /** Services /api/auth/status reports as logged in; a successful login adds its service. */
  authed: Set<string>
  /** Status POST /api/auth/login answers (200, or e.g. 500 for a failed login). */
  loginStatus: number
  /** What /api/auth/geo-availability answers for Yodel. */
  geoBlocked: boolean
  /** Services a login was POSTed for, in order. */
  loginCalls: string[]
  settings: Record<string, unknown>
  /** Bodies of POST /api/settings, in order. */
  settingsSaves: Record<string, unknown>[]
  /** Status POST /api/settings answers (500 shows the App error toast). */
  settingsSaveStatus: number
  /** /api/sync/progress per service (idle when missing); tests change it to move a sync on. */
  progress: Record<string, Record<string, unknown>>
}

export interface EntryOptions {
  /** ToS already accepted (default false: first launch). */
  tosAccepted?: boolean
  /** Services selected at start (default none: the landing page). */
  services?: string[]
  /** Output folder already set (default false: the setup wizard shows). */
  configured?: boolean
  /** Services logged in at start. */
  authed?: string[]
}

export async function pinEntry(page: Page, opts: EntryOptions = {}): Promise<EntryState> {
  // Content, blog, media and conversation routes; registered first so the routes below win.
  await pinBlogs(page)
  const services = opts.services ?? []
  const state: EntryState = {
    authed: new Set(opts.authed ?? []),
    loginStatus: 200,
    geoBlocked: false,
    loginCalls: [],
    settings: {
      output_dir: opts.configured ? '/fixture/out' : '',
      auto_sync_enabled: false,
      adaptive_sync_enabled: false,
      sync_interval_minutes: 15,
      is_configured: opts.configured ?? false,
      incoming_call_enabled: false,
      notifications_enabled: false,
      close_to_tray: true,
    },
    settingsSaves: [],
    settingsSaveStatus: 200,
    progress: {},
  }

  await page.route('**/api/app-state/prefs', (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 204 })
    return route.fulfill({
      json: {
        language: 'en',
        ...(opts.tosAccepted ? { tos_accepted_at: '2026-01-01T00:00:00Z' } : {}),
        'sakadesk-app-state': JSON.stringify({
          state: {
            selectedServices: services,
            activeService: services[0] ?? null,
            activeFeatures: Object.fromEntries(services.map((s) => [s, 'messages'])),
          },
          version: 4,
        }),
      },
    })
  })

  // Auth: the catch-all first (later routes win), then the paths the app uses.
  await page.route('**/api/auth/**', (route) => route.abort('blockedbyclient'))
  await page.route((url) => url.pathname === '/api/auth/status', (route) =>
    route.fulfill({
      json: { services: Object.fromEntries(ALL_SERVICES.map((s) => [s, { authenticated: state.authed.has(s) }])) },
    }),
  )
  await page.route((url) => url.pathname === '/api/auth/login', (route) => {
    const service = new URL(route.request().url()).searchParams.get('service') ?? ''
    state.loginCalls.push(service)
    if (state.loginStatus !== 200) return route.fulfill({ status: state.loginStatus, json: { detail: 'pinned failure' } })
    state.authed.add(service)
    return route.fulfill({ json: { success: true } })
  })
  await page.route((url) => url.pathname === '/api/auth/geo-availability', (route) =>
    route.fulfill({ json: { blocked: state.geoBlocked } }),
  )
  await page.route((url) => url.pathname === '/api/auth/refresh-if-needed', (route) =>
    route.fulfill({ json: { refreshed: false } }),
  )

  await page.route((url) => url.pathname === '/api/settings', (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      state.settingsSaves.push(body)
      if (state.settingsSaveStatus !== 200) return route.fulfill({ status: state.settingsSaveStatus, json: { detail: 'pinned failure' } })
      Object.assign(state.settings, body)
      if (typeof body.output_dir === 'string' && body.output_dir) state.settings.is_configured = true
    }
    return route.fulfill({ json: state.settings })
  })
  await page.route((url) => url.pathname.startsWith('/api/settings/service/'), (route) => route.fulfill({ json: {} }))
  await page.route((url) => url.pathname === '/api/settings/fresh', (route) => route.fulfill({ json: { is_fresh: false } }))

  await page.route('**/api/sync/start*', (route) => route.fulfill({ json: { status: 'started' } }))
  await page.route('**/api/sync/cancel*', (route) => route.fulfill({ json: { status: 'cancelled' } }))
  await page.route('**/api/sync/progress*', (route) => {
    const service = new URL(route.request().url()).searchParams.get('service') ?? ''
    return route.fulfill({ json: state.progress[service] ?? { state: 'idle' } })
  })
  await page.route('**/api/profile**', (route) => route.fulfill({ json: {} }))
  return state
}
