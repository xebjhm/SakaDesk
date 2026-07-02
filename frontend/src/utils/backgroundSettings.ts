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
 * Save background settings to localStorage.
 *
 * @returns `true` if persisted successfully, `false` if the write failed
 *          (e.g. localStorage quota exceeded or unavailable). Callers should
 *          surface the failure so the user knows the background will not
 *          survive a restart, rather than silently swallowing it.
 */
export function saveBackgroundSettings(conversationPath: string, settings: BackgroundSettings): boolean {
  try {
    localStorage.setItem(`bg_settings_${conversationPath}`, JSON.stringify(settings));
    return true;
  } catch {
    // Storage quota exceeded or unavailable
    return false;
  }
}
