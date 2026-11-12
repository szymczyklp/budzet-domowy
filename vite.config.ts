import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base './' działa zarówno lokalnie, jak i pod https://<login>.github.io/<repo>/
/**
 * Content-Security-Policy w wersji produkcyjnej (w trybie dev Vite potrzebuje skryptów wbudowanych).
 * Dozwolone tylko: własny kod, Google (Picker, Drive API, logowanie) i pośrednik logowania.
 */
const CSP = [
  "default-src 'self'",
  // Google Picker dociąga skrypty, ramki i obrazy z kilku domen Google – dopuszczamy całe rodziny domen Google
  "script-src 'self' https://*.google.com https://*.gstatic.com https://*.googleapis.com",
  "style-src 'self' 'unsafe-inline' https://*.gstatic.com https://*.googleapis.com",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.gstatic.com https://*.google.com",
  "font-src 'self' data: https://*.gstatic.com",
  "connect-src 'self' https://*.googleapis.com https://*.google.com https://budzet-auth.szymczyklp.workers.dev",
  "frame-src https://*.google.com https://*.googleapis.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const cspPlugin = () => ({
  name: 'csp-meta',
  apply: 'build' as const,
  transformIndexHtml: (html: string) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="referrer" content="strict-origin" />`),
});

export default defineConfig({
  base: './',
  plugins: [
    react(),
    cspPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      // strona polityki prywatności ma się otwierać sama, a nie przez aplikację
      workbox: { navigateFallbackDenylist: [/prywatnosc\.html$/] },
      manifest: {
        name: 'Budżet domowy',
        short_name: 'Budżet',
        description: 'Domowy budżet: plan, rozliczenia i prognoza',
        lang: 'pl',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f5f6f1',
        theme_color: '#1e2b3a',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
});
