import { http, HttpResponse } from 'msw'

// Test data matching backend fixtures
const TEST_MEMBER = {
  id: 'test_member_001',
  name: 'Test Member',
  thumbnail: '/api/content/media/test/thumbnail.jpg',
  portrait: '/api/content/media/test/portrait.jpg',
  phone_image: null,
}

const TEST_MESSAGES = [
  {
    id: 1,
    timestamp: '2024-01-15T09:00:00Z',
    type: 'text',
    content: 'Hello! This is a test message.',
    is_favorite: false,
    media_file: null,
    width: null,
    height: null,
  },
  {
    id: 2,
    timestamp: '2024-01-15T09:05:00Z',
    type: 'text',
    content: 'This is another test message.',
    is_favorite: true,
    media_file: null,
    width: null,
    height: null,
  },
]

export const handlers = [
  // Auth status - always authenticated for integration tests (multi-service format)
  http.get('/api/archive/stats', () => {
    return HttpResponse.json({ messages: 0, photos: 0, first_message_at: null })
  }),
  http.get('/api/auth/status', () => {
    return HttpResponse.json({
      services: {
        'hinatazaka46': {
          authenticated: true,
          app_id: 'test_app_id',
          storage_type: 'test',
        }
      }
    })
  }),

  // Groups list - returns array directly as expected by Sidebar
  http.get('/api/content/groups', () => {
    return HttpResponse.json([
      {
        id: 'test_member_001',
        name: 'Test Member',
        service: 'hinatazaka46',
        dir_name: 'test_member_001',
        group_path: 'individual/test_member_001',
        member_count: 1,
        is_group_chat: false,
        is_active: true,
        last_message_id: 2,
        total_messages: 2,
        members: [
          {
            id: 'test_member_001',
            name: 'Test Member',
            path: 'individual/test_member_001',
            thumbnail: '/api/content/media/test/thumbnail.jpg',
            portrait: '/api/content/media/test/portrait.jpg',
            phone_image: null,
          },
        ],
      },
    ])
  }),

  // Messages by path
  http.get('/api/content/messages_by_path', ({ request }) => {
    const url = new URL(request.url)
    const lastReadId = parseInt(url.searchParams.get('last_read_id') || '0')

    return HttpResponse.json({
      member: TEST_MEMBER,
      messages: TEST_MESSAGES,
      total_count: TEST_MESSAGES.length,
      unread_count: TEST_MESSAGES.filter(m => m.id > lastReadId).length,
      max_message_id: Math.max(...TEST_MESSAGES.map(m => m.id)),
    })
  }),

  // Settings
  http.get('/api/settings', () => {
    return HttpResponse.json({
      output_dir: '/tmp/sakadesk_test',
      auto_sync_enabled: false,
      sync_interval_minutes: 30,
      adaptive_sync_enabled: false,
      blogs_full_backup: false,
      is_configured: true,
    })
  }),

  // Per-service settings
  http.get('/api/settings/service/:service', () => {
    return HttpResponse.json({
      blogs_full_backup: false,
    })
  }),

  // Save settings
  http.put('/api/settings', () => {
    return HttpResponse.json({ success: true })
  }),

  // Save per-service settings
  http.put('/api/settings/service/:service', () => {
    return HttpResponse.json({ success: true })
  }),

  // Fresh install check
  http.get('/api/settings/fresh', () => {
    return HttpResponse.json({ is_fresh: false })
  }),

  // User profile
  http.get('/api/profile', () => {
    return HttpResponse.json({ nickname: 'TestUser', error: null })
  }),

  // Refresh profile
  http.post('/api/profile/refresh', () => {
    return HttpResponse.json({ nickname: 'TestUser', error: null })
  }),

  // Sync progress (idle)
  http.get('/api/sync/progress', () => {
    return HttpResponse.json({ state: 'idle' })
  }),

  // Start sync (noop for tests)
  http.post('/api/sync/start', () => {
    return HttpResponse.json({ success: true })
  }),

  // Next sync interval
  http.get('/api/sync/next_interval', () => {
    return HttpResponse.json({ interval_minutes: 10 })
  }),

  // Unread counts - returns empty for tests
  http.post('/api/content/unread_counts', () => {
    return HttpResponse.json({})
  }),

  // Read states batch
  http.post('/api/read-states/batch', () => {
    return HttpResponse.json({ success: true })
  }),

  // UI breadcrumbs (fire-and-forget)
  http.post('/api/client-log', () => {
    return new HttpResponse(null, { status: 204 })
  }),

  // Call popup ownership (main-window check)
  http.get('/api/call-popup/active', () => {
    return HttpResponse.json({ active: false })
  }),

  // Call popup page (default: the backend no longer knows the call; events accepted)
  http.get('/api/call-popup/calls/:id', () => {
    return new HttpResponse(null, { status: 404 })
  }),
  http.post('/api/call-popup/calls/:id/events', () => {
    return new HttpResponse(null, { status: 204 })
  }),

  // Blog cache size
  http.get('/api/blogs/cache-size', () => {
    return HttpResponse.json({ size_bytes: 0 })
  }),

  // Search status
  http.get('/api/search/status', () => {
    return HttpResponse.json({ indexed_count: 0, is_building: false })
  }),

  // Version check
  http.get('/api/version', () => {
    return HttpResponse.json({
      current_version: '0.1.0',
      latest_version: '0.1.0',
      update_available: false,
      release_url: null,
      release_notes: null,
      last_checked: null,
      error: null,
      upgrade_supported: false,
    })
  }),

  // Focused-chat reporting (fire-and-forget)
  http.post('/api/ui-state', () => {
    return new HttpResponse(null, { status: 204 })
  }),

  // Backend app-state store (empty store, already migrated). Answered so the
  // startup conversation-cache load succeeds instead of retrying with backoff.
  http.get('/api/app-state/prefs', () => HttpResponse.json({})),
  http.patch('/api/app-state/prefs', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/app-state/conversation-all', () => HttpResponse.json({})),
  http.get('/api/app-state/conversation', () => HttpResponse.json({})),
  http.patch('/api/app-state/conversation', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/app-state/migrate', () => HttpResponse.json({ migrated: true })),

  // Read-state search copy (fire-and-forget)
  http.put('/api/read-states', () => new HttpResponse(null, { status: 204 })),
]

/**
 * Opt-in Memories time-capsule reads with no notes, for a test whose screen mounts a day view or
 * On This Day but is not about notes: `server.use(...memoriesCapsuleEmpty)` in its `beforeEach`.
 * Not in the default `handlers`, so a test that forgets to declare the capsule reads still fails
 * on the unhandled request. Tests about notes mock `fetchCapsule` / `fetchCapsuleDue` instead.
 */
export const memoriesCapsuleEmpty = [
  http.get('/api/memories/:service/capsule', () => HttpResponse.json({ notes: [] })),
  http.get('/api/memories/:service/capsule/due', () => HttpResponse.json({ notes: [] })),
]
