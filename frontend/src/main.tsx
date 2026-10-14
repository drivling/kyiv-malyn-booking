import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { captureInstallPrompt } from './pwa/installPrompt'
import './index.css'

// До першого рендера: beforeinstallprompt приходить один раз і рано (Docs/transport-pwa-2026-10.md)
captureInstallPrompt()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
