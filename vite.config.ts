import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Repo root also holds spike/*.html (frozen R&D pages, not part of this
  // app) — without this, Vite's dep scanner crawls them too and fails on
  // their vendored/CDN-only imports.
  optimizeDeps: {
    entries: ['index.html'],
  },
})
