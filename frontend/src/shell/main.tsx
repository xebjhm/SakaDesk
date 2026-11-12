import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'

// Initialize i18n before rendering the app
import '../i18n'

import { clientLog } from '../utils/clientLog'
import { bootstrapApiCookie, installApiAuth, sessionStorageOrNull, takeLaunchToken } from '../core/api/launchAuth'
import { installCallPopupBridge } from '../features/callPopup/callPopupBridge'
import { isCallPopupView } from './callPopupRoute'
import { isDesignView } from '../design/designRoute'
import { isTimelineProbeView } from '../features/messages/timeline/probeRoute'
import { applyStaticTokens } from '../design/applyTokens'
import { installLanguageFonts } from '../design/fonts'

// Design tokens must exist before the first paint of any entry point.
applyStaticTokens()
installLanguageFonts()

// Launch auth before any request: the token header and the media cookie must exist
// before the first fetch or <img> (security audit 2026-11-13). Without a token (Vite dev
// server, e2e) the dev proxy / Playwright adds the header instead.
const launchToken = takeLaunchToken(window.location, sessionStorageOrNull(), window.history)
if (launchToken) installApiAuth(launchToken)
const apiReady: Promise<void> = launchToken
    ? bootstrapApiCookie().then((ok) => {
          if (!ok) clientLog('app_load_failed', { error_type: 'api_bootstrap' })
      })
    : Promise.resolve()

const root = ReactDOM.createRoot(document.getElementById('root')!)

// One route per entry point, each loaded on demand.
// Dev-only style page. `import.meta.env.DEV` is the literal `false` in production
// builds, so this whole branch — including the chunk import — is dropped.
if (import.meta.env.DEV && isDesignView(window.location.search)) {
    import('../design/DesignPage').then(({ DesignPage }) => {
        root.render(
            <React.StrictMode>
                <DesignPage />
            </React.StrictMode>,
        )
    }).catch(() => clientLog('app_load_failed', { error_type: 'design_page' }))
} else if (import.meta.env.DEV && isTimelineProbeView(window.location.search)) {
    // Dev-only GroupedVirtuoso probe (e2e/probe). Dropped from production builds like the design page.
    import('../features/messages/timeline/TimelineProbe').then(({ TimelineProbe }) => {
        root.render(<TimelineProbe />)
    }).catch(() => clientLog('app_load_failed', { error_type: 'timeline_probe' }))
} else if (isCallPopupView(window.location.search)) {
    // Loaded on demand so the popup never evaluates App's module graph (and the main window
    // never loads the popup's).
    // The host evaluates `window.__sakadeskCallPopup.start(...)` right after the page's `loaded`
    // event, which can precede the chunk below: publish the (queueing) global synchronously.
    installCallPopupBridge()
    apiReady.then(() => Promise.all([
        import('../core/common/ErrorBoundary'),
        import('../features/callPopup'),
    ])).then(([{ ErrorBoundary }, { CallPopupApp }]) => {
        // The bottom-right call popup: no auth, no App shell, no sync, no ui-state reporter.
        root.render(
            <React.StrictMode>
                <ErrorBoundary>
                    <CallPopupApp />
                </ErrorBoundary>
            </React.StrictMode>,
        )
    }).catch(() => clientLog('call_popup_error', { error_type: 'load_failed' }))
} else {
    apiReady.then(() => Promise.all([
        import('./App'),
        import('../core/common/ErrorBoundary'),
        import('./context/AuthContext'),
    ])).then(([{ default: App }, { ErrorBoundary }, { AuthProvider }]) => {
        root.render(
            <React.StrictMode>
                <AuthProvider>
                    <ErrorBoundary>
                        <App />
                    </ErrorBoundary>
                </AuthProvider>
            </React.StrictMode>,
        )
    }).catch(() => clientLog('app_load_failed', { error_type: 'load_failed' }))
}
