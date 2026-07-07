// src/utils/nameFormatters.ts
// Shared name formatting utilities used across message and chat components

/**
 * Replace underscores with spaces in display names.
 *
 * SD-FE-GAP-A-04: the `name` type is `string`, but avatar/member data from the
 * backend or network can be nullish at runtime; guard so callers in render
 * paths never throw on a missing display name.
 */
export function formatName(name: string): string {
  return (name ?? '').replace(/_/g, ' ');
}

/**
 * Get first 2 characters of the formatted name (for avatars).
 *
 * SD-FE-GAP-A-04: mirror getInitials' robustness — return a visible fallback
 * ('?') instead of a blank string when the name is empty/whitespace/nullish,
 * so a missing display name renders a sensible avatar rather than nothing.
 * SD-FE-GAP-A-05: slice by CODE POINTS (Array.from) so an astral char / emoji
 * name isn't cut in half (a lone surrogate).
 */
export function getShortName(name: string): string {
  const parts = formatName(name).trim().split(' ');
  const first = Array.from(parts[0]).slice(0, 2).join('');
  return first || '?';
}

/**
 * Get initials from name (up to 2 characters, uppercase).
 *
 * SD-FE-GAP-A-05: take the first code point of each token via Array.from so a
 * surrogate-pair character contributes a whole glyph, not half of one.
 */
export function getInitials(name: string): string {
  return Array.from(
    formatName(name)
      .split(' ')
      .map(p => Array.from(p)[0])
      .filter(Boolean)
      .join(''),
  )
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
