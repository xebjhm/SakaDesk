/**
 * App version, read from pyproject.toml at build time.
 * This is the single source of truth — no hardcoded versions elsewhere.
 */

// Vite imports raw text with ?raw suffix
import pyproject from '../../pyproject.toml?raw';

const match = pyproject.match(/^version\s*=\s*"([^"]+)"/m);
export const APP_VERSION = match ? match[1] : '0.0.0';
