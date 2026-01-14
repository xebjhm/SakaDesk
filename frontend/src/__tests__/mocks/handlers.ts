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
  http.get('/api/auth/status', () => {
    return HttpResponse.json({
      services: {
        'Hinatazaka46': {
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
        service: 'Hinatazaka46',
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
      output_dir: '/tmp/hakodesk_test',
      auto_sync_enabled: false,
      sync_interval_minutes: 30,
      is_configured: true,
    })
  }),

  // Fresh install check
  http.get('/api/settings/fresh', () => {
    return HttpResponse.json({ is_fresh: false })
  }),

  // Sync progress (idle)
  http.get('/api/sync/progress', () => {
    return HttpResponse.json({ state: 'idle' })
  }),

  // Start sync (noop for tests)
  http.post('/api/sync/start', () => {
    return HttpResponse.json({ success: true })
  }),

  // Unread counts - returns empty for tests
  http.post('/api/content/unread_counts', () => {
    return HttpResponse.json({})
  }),
]
