import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
  },
  // Rapier ships WASM; keep it out of pre-bundling surprises.
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
})
