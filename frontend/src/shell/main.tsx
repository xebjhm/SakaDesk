import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '../index.css'

// Initialize i18n before rendering the app
import '../i18n'

import { ErrorBoundary } from '../core/common/ErrorBoundary'
import { AuthProvider } from './context/AuthContext'
import { CallPopupApp } from '../features/callPopup'
import { isCallPopupView } from './callPopupRoute'

const root = ReactDOM.createRoot(document.getElementById('root')!)
if (isCallPopupView(window.location.search)) {
    // The bottom-right call popup: no auth, no App shell, no sync, no ui-state reporter.
    root.render(
        <React.StrictMode>
            <ErrorBoundary>
                <CallPopupApp />
            </ErrorBoundary>
        </React.StrictMode>,
    )
} else {
    root.render(
        <React.StrictMode>
            <AuthProvider>
                <ErrorBoundary>
                    <App />
                </ErrorBoundary>
            </AuthProvider>
        </React.StrictMode>,
    )
}
