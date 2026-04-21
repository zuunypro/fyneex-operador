import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  envPrefix: 'VITE_',
  server: {
    host: '0.0.0.0',
    // Needed so the mobile wrapper (Expo Go on a phone) can reach the dev server
    // over the LAN and hit the same-origin /api proxy. Default host: 'localhost'
    // would only bind to the loopback interface and reject the phone.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2019', // support iOS 12+/older Android WebViews without polyfills
    cssTarget: 'chrome80',
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'react'
          if (id.includes('@tanstack/react-query')) return 'query'
          if (id.includes('/zustand/')) return 'state'
        },
      },
    },
  },
})
