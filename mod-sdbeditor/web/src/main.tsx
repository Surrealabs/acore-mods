

import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Error logging setup for frontend
function logFrontendErrorToFile(message: string) {
  // Send error to backend for logging (if backend endpoint exists)
  fetch('/error-logs/frontend-errors.log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message }),
  }).catch(() => {});
}

window.addEventListener('error', (event) => {
  logFrontendErrorToFile(`Uncaught error: ${event.message} at ${event.filename}:${event.lineno}`);
});

window.addEventListener('unhandledrejection', (event) => {
  logFrontendErrorToFile(`Unhandled promise rejection: ${event.reason}`);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
