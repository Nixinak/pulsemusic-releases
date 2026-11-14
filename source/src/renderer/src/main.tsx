import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/figtree'
import '@fontsource-variable/bricolage-grotesque/standard.css'
import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import '@fontsource-variable/outfit'
import './styles/base.css'
import './styles/layout.css'
import './styles/recap.css'
import './styles/pages.css'
import './styles/v2.css'
import './styles/v3.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
