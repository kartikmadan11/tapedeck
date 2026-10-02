import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],

  server: {
    port: 5173,
    // In development the API is a separate process, so the browser talks to Vite
    // and Vite forwards. In production both are the same origin, which is why
    // there is no CORS configuration anywhere in this project.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
  },

  // Declared here rather than in the root config so the tests run through the
  // same plugins as the app, which is what lets a .tsx test compile at all.
  test: {
    name: 'frontend',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
  },
})
