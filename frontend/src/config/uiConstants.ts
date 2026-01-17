// src/config/uiConstants.ts
// Shared UI constants for consistent sizing, timing, and limits

export const UI_CONSTANTS = {
  media: {
    maxWidth: 320,
    maxHeight: 500,
    defaultHeight: 200,
  },
  interaction: {
    longPressMs: 600,
    debounceMs: 300,
  },
  polling: {
    sidebarMs: 2000,
    syncCheckMs: 5000,
  },
  contextMenu: {
    width: 200,
    itemHeight: 48,
    padding: 8,
  },
  limits: {
    maxImageSizeBytes: 2 * 1024 * 1024, // 2MB
  },
  backgroundPresets: [
    '#E2E6EB', // Default gray
    '#FEE2E2', // Light red
    '#FEF3C7', // Light yellow
    '#D1FAE5', // Light green
    '#DBEAFE', // Light blue
    '#E9D5FF', // Light purple
    '#FCE7F3', // Light pink
    '#F5F5F4', // Stone
  ],
} as const;

// Shelter message type colors
export const SHELTER_COLORS = {
  video: '#c4a8d8',
  text: '#8bb8d6',
  voice: '#b8a8d8',
  picture: '#a8d0e8',
} as const;

// Shelter message type icons (emoji)
export const SHELTER_ICONS = {
  video: '\u{1F3AC}', // 🎬
  text: '\u{1F4AC}', // 💬
  voice: '\u{1F3A4}', // 🎤
  picture: '\u{1F4F7}', // 📷
} as const;
