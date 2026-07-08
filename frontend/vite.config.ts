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
        host: '0.0.0.0',
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:8000',
                changeOrigin: true,
            },
            '/media': {
                target: 'http://127.0.0.1:8000',
                changeOrigin: true,
            }
        }
    }
})
