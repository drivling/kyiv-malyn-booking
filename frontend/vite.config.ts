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
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
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
    ],
  },
})
