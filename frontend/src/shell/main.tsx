import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '../index.css'

import { ErrorBoundary } from '../core/common/ErrorBoundary'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </React.StrictMode>,
)
