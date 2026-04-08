import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// Suppress harmless internal THREE.js warnings thrown by @react-three/fiber
const originalWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('THREE.Clock: This module has been deprecated')) return;
  originalWarn(...args);
};

// Suppress harmless local dev WebGL Context Lost errors during hot-reloads
const originalError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('WebGLRenderer: Context Lost')) return;
  originalError(...args);
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
