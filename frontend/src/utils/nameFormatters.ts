// src/utils/nameFormatters.ts
// Shared name formatting utilities used across message and chat components

/**
 * Replace underscores with spaces in display names
 */
export function formatName(name: string): string {
  return name.replace(/_/g, ' ');
}

/**
 * Get first 2 characters of the formatted name (for avatars)
 */
export function getShortName(name: string): string {
  const parts = formatName(name).split(' ');
  return parts[0].substring(0, 2);
}

/**
 * Get initials from name (up to 2 characters, uppercase)
 */
export function getInitials(name: string): string {
  return formatName(name)
    .split(' ')
    .map(p => p[0])
    .filter(Boolean)
    .join('')
    .substring(0, 2)
    .toUpperCase();
}
