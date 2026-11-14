import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// Single source of truth for the displayed app version: the backend pyproject.toml.
// Previously read from ./package.json, which drifted (0.3.1 vs pyproject 0.3.2) and
// leaked the stale version into the About dialog + bug-report template.
// See code review 2026-07-07, WP-1 / Theme F.
const pyprojectPath = path.resolve(__dirname, '../pyproject.toml')
const versionMatch = fs.readFileSync(pyprojectPath, 'utf-8').match(/^version\s*=\s*"([^"]+)"/m)
if (!versionMatch) {
    throw new Error(`Could not read version from ${pyprojectPath}`)
}
const APP_VERSION = versionMatch[1]

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    define: {
        __APP_VERSION__: JSON.stringify(APP_VERSION),
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        // Loopback only: the proxied API is for this machine (security audit 2026-11-13).
        // 127.0.0.1 rather than localhost: Node on Windows resolves localhost to ::1 alone,
        // which the dev scripts' probes and the http://127.0.0.1 app URL would not reach.
        host: '127.0.0.1',
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:8000',
                // Host is not rewritten: the backend must see the browser's own Host, so it still
                // rejects non-loopback hosts and its exact-Origin check sees Origin == Host.
                // The proxy adds no credentials: the page authenticates itself with the #t= token
                // in the URL that dev.sh / dev.ps1 open, exactly like SakaDesk's own windows.
            },
        },
    },
})
