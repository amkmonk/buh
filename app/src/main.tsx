import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/golos-text/400.css'
import '@fontsource/golos-text/500.css'
import '@fontsource/golos-text/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/unbounded/500.css'
import './styles.css'
import App from './App.tsx'
import { applyTheme } from './lib/theme'

applyTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Browser version only: cache the app shell so it opens without a connection.
if (import.meta.env.PROD && import.meta.env.VITE_NATIVE !== '1' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js'))
}
