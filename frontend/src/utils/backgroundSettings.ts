// src/utils/backgroundSettings.ts
// Shared background settings utilities for chat customization

import type { BackgroundSettings } from '../types';

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  type: 'default',
  color: '#E2E6EB',
  opacity: 100,
};

/**
 * Load background settings from localStorage
 */
export function loadBackgroundSettings(conversationPath: string): BackgroundSettings {
  try {
    const saved = localStorage.getItem(`bg_settings_${conversationPath}`);
    if (saved) {
      return JSON.parse(saved) as BackgroundSettings;
    }
  } catch {
    // Ignore parse errors, return default
  }
  return DEFAULT_BACKGROUND;
}

/**
 * Save background settings to localStorage
 */
export function saveBackgroundSettings(conversationPath: string, settings: BackgroundSettings): void {
  try {
    localStorage.setItem(`bg_settings_${conversationPath}`, JSON.stringify(settings));
  } catch {
    // Storage quota exceeded or unavailable - silently fail
  }
}
