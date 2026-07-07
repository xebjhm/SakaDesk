// src/utils/backgroundSettings.ts
// Shared background settings utilities for chat customization

import type { BackgroundSettings } from '../types';
import { persisted } from '../core/persistence/persisted';

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  type: 'default',
  color: '#E2E6EB',
  opacity: 100,
};

/**
 * Load background settings from persisted app-state
 */
export function loadBackgroundSettings(conversationPath: string): BackgroundSettings {
  try {
    const saved = persisted.getConv<{ value?: string }>(`bg_settings_${conversationPath}`, {}).value ?? null;
    if (saved) {
      return JSON.parse(saved) as BackgroundSettings;
    }
  } catch {
    // Ignore parse errors, return default
  }
  return DEFAULT_BACKGROUND;
}

/**
 * Save background settings to persisted app-state
 */
export function saveBackgroundSettings(conversationPath: string, settings: BackgroundSettings): void {
  try {
    persisted.setConv(`bg_settings_${conversationPath}`, { value: JSON.stringify(settings) });
  } catch {
    // Storage quota exceeded or unavailable - silently fail
  }
}
