import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    host: '0.0.0.0',
    allowedHosts: [
      '.railway.app',
      'frontend-production-34cd.up.railway.app',
      'malin.kiev.ua',
      'www.malin.kiev.ua',
      'korosten.kiev.ua',
      'www.korosten.kiev.ua',
      'korosten.localhost',
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Канонічні адреси відкритих даних (apiRedirectPath у scripts/serve-dist-rules.mjs): у проді serve-dist
      // відповідає 302 на бекенд, у dev — той самий шлях на локальний бекенд, щоб кнопки на сайті працювали
      ...Object.fromEntries(
        ['/transport/gtfs.zip', '/transport/gtfs/', '/openapi.yaml', '/transport/changes.rss', '/transport/dataset', '/transport/revisions', '/transport/stops/', '/transport/stop-redirects', '^/transport/route/[^/]+/calendar\\.ics$'].map(
          (key) => [key, { target: 'http://localhost:3000', changeOrigin: true }]
        )
      ),
    },
  },
  preview: {
    port: Number(process.env.PORT) || 5173,
    host: '0.0.0.0',
    allowedHosts: [
      '.railway.app',
      'frontend-production-34cd.up.railway.app',
      'malin.kiev.ua',
      'www.malin.kiev.ua',
      'korosten.kiev.ua',
      'www.korosten.kiev.ua',
      'korosten.localhost',
    ],
  },
})
