import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './lib/store';
import { SyncProvider } from './sync/SyncProvider';
import App from './App';
import AppLock from './AppLock';
import ErrorBoundary from './ErrorBoundary';
import './styles.css';
import { handleRedirect } from './sync/google';

// wynik logowania Google (#access_token=…) odbieramy, zanim widoki przeczytają adres
// aplikacja nie może działać w ramce obcej strony (clickjacking) – GitHub Pages nie pozwala ustawić nagłówka
if (window.top !== window.self) {
  document.body.textContent = 'Budżet domowy nie działa w ramce innej strony.';
  throw new Error('framed');
}

handleRedirect();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <SyncProvider>
        <AppLock>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </AppLock>
      </SyncProvider>
    </StoreProvider>
  </StrictMode>,
);
