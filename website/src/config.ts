/**
 * App version, parsed from pyproject.toml at build time
 * so it stays in sync with the Python project.
 */

// Astro (via Vite) imports file contents as a string with the ?raw suffix
import pyproject from '../../pyproject.toml?raw';

const match = pyproject.match(/^version\s*=\s*"([^"]+)"/m);
// APP_VERSION is display-only (version badges). It is intentionally NOT used to
// build the download link — see DOWNLOAD_URL below.
export const APP_VERSION = match ? match[1] : '0.0.0';

/**
 * XREPO-06 / SD-AUX-07: the download button must NEVER point at a
 * version-specific asset built from pyproject. The version bump merges to main
 * (and can trigger a website deploy) BEFORE the tag is pushed and the CI build
 * uploads the installer — so a URL like
 * `.../releases/download/v${APP_VERSION}/SakaDesk-${APP_VERSION}-Setup.exe`
 * 404s for the whole window (and forever if CI fails or the tag is never
 * pushed). GitHub's `releases/latest` permalink always resolves to the newest
 * PUBLISHED release regardless of what pyproject says, so it can never 404.
 */
export const GITHUB_REPO_URL = 'https://github.com/xebjhm/SakaDesk';
export const DOWNLOAD_URL = `${GITHUB_REPO_URL}/releases/latest`;
