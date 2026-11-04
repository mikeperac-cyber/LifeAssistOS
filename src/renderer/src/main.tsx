import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyAppTheme, getSavedAppTheme } from './theme'
import App from './App'
import './styles.css'

applyAppTheme(document.documentElement, getSavedAppTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
