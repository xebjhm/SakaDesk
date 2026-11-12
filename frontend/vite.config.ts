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

// Per-launch API token shared with the backend (dev.sh / dev.ps1 export it for both).
const API_TOKEN = process.env.SAKADESK_API_TOKEN

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
    if (command === 'serve' && !API_TOKEN) {
        console.warn(
            '[sakadesk] SAKADESK_API_TOKEN is not set: /api requests through the dev proxy will get 401. ' +
            'Start with dev.sh / dev.ps1, or export the same value for the backend and Vite.',
        )
    }
    return {
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
            // Vite's default host (localhost): the proxied API is for this machine only
            // (security audit 2026-11-13).
            proxy: {
                '/api': {
                    target: 'http://127.0.0.1:8000',
                    // Host is not rewritten: the backend must see the browser's own Host, so it still
                    // rejects non-loopback hosts and its exact-Origin check sees Origin == Host.
                    // The proxy adds the per-launch token that dev.sh / dev.ps1 share with the
                    // backend; the page itself never holds it.
                    headers: API_TOKEN ? { 'X-SakaDesk-Token': API_TOKEN } : undefined,
                },
            },
        },
    }
})
