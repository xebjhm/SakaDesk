/**
 * App version, parsed from pyproject.toml at build time
 * so it stays in sync with the Python project.
 */

// Astro (via Vite) imports file contents as a string with the ?raw suffix
import pyproject from '../../pyproject.toml?raw';

const match = pyproject.match(/^version\s*=\s*"([^"]+)"/m);
export const APP_VERSION = match ? match[1] : '0.0.0';
