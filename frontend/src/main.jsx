import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { UIProvider } from './context/UIContext';
import './index.css';
import { startMobileTables } from './lib/mobileTables';

startMobileTables();

// Após uma nova publicação, os arquivos antigos deixam de existir: recarrega uma vez (no máximo 1x por minuto).
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'apolven:preload-reload';
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 60000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* sem sessionStorage: não recarrega para evitar laço */ return; }
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <UIProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </UIProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
